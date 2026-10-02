/**
 * AI provider seam.
 *
 * Every model call in the application goes through this module, so the AI layer
 * is a replaceable dependency rather than something hard-wired to the Groq SDK.
 * Production resolves to the Groq provider; tests inject a deterministic
 * implementation and never need an API key or a network.
 *
 * The interface is deliberately narrow — a completion and a stream — because
 * that is all the application actually asks of a model. Provider-specific
 * response shapes belong in the provider, not in the services, so that a change
 * of vendor does not ripple into parsing code.
 *
 * This module also owns the two runtime guarantees every AI request has: a
 * non-streaming completion is bounded by total duration, and a stream is bounded
 * by inactivity. The boundaries are applied here, at the seam, rather than in
 * each service, so a new AI feature inherits them for free and a provider that
 * never responds cannot hold a request open indefinitely.
 *
 * @typedef {Object} AICompletionRequest
 * @property {Array<{ role: string, content: string }>} messages
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {string} [model]
 *
 * @typedef {Object} AICompletionResult
 * @property {string|undefined} content Raw text as the model returned it. It is
 *   intentionally not coerced: deciding what to do with an absent or malformed
 *   body is the caller's job, and that decision is what the tests exercise.
 * @property {{ promptTokens?: number, completionTokens?: number, totalTokens?: number }} [usage]
 *
 * @typedef {Object} AIStreamChunk
 * @property {string} content
 *
 * @typedef {Object} AIProvider
 * @property {(request: AICompletionRequest) => Promise<AICompletionResult>} complete
 * @property {(request: AICompletionRequest) => Promise<AsyncIterable<AIStreamChunk>>} stream
 */

import { createGroqProvider } from "./groqProvider.js";

/**
 * Upper bound on a single non-streaming completion.
 *
 * A documented default rather than configuration: this repository has no timeout
 * configuration pattern, and adding one would mean either a new required
 * environment variable (which would fail startup when unset) or a new optional
 * one. 30s sits comfortably above the latency of a 2048-2500 token completion on
 * the production model while still capping the worst case per call.
 *
 * Named and exported so the boundary, the tests and the documentation all refer
 * to one value.
 */
export const AI_COMPLETION_TIMEOUT_MS = 30_000;

/**
 * Raised when a non-streaming completion does not settle within the boundary.
 *
 * Deliberately a plain Error rather than an AppError subclass: it must travel the
 * same path as any other provider failure, so the existing per-service degradation
 * applies unchanged. It carries no provider internals, so nothing internal leaks
 * to an HTTP caller through it.
 */
export class AIProviderTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`AI provider did not respond within ${timeoutMs}ms`);
    this.name = "AIProviderTimeoutError";
    this.code = "AI_PROVIDER_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Bounds a provider promise.
 *
 * The timer is cleared on both settlement paths so a completed request never
 * leaves a pending timer behind, and it is unreferenced so a still-pending one
 * cannot hold the process open. Each call gets its own timer, so concurrent
 * requests have independent lifecycles.
 */
const withCompletionTimeout = (pending, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AIProviderTimeoutError(timeoutMs));
    }, timeoutMs);

    if (typeof timer?.unref === "function") timer.unref();

    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Maximum time allowed to wait for the next item on a streaming response.
 *
 * A total-duration limit would be wrong for streaming, since a long answer is
 * healthy as long as it keeps producing. This bounds only the *gap* between
 * items, so a continuously producing stream of any length is unaffected. It
 * matches the completion boundary so there is a single documented AI latency
 * budget, and it also covers the wait for the stream to open at all, which is
 * itself an upstream request that can stall.
 */
export const AI_STREAM_INACTIVITY_TIMEOUT_MS = 30_000;

/**
 * Raised when a stream goes quiet for longer than the inactivity boundary.
 *
 * Distinct from the completion timeout because the two policies are different:
 * a total-duration deadline and a per-gap deadline are not interchangeable, and a
 * caller debugging a stalled response needs to tell them apart. Like the
 * completion error it is a plain Error, so it travels the existing catch path,
 * and it carries no provider, socket or SDK detail.
 */
export class AIProviderStreamTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`AI provider stream stalled for more than ${timeoutMs}ms`);
    this.name = "AIProviderStreamTimeoutError";
    this.code = "AI_PROVIDER_STREAM_TIMEOUT";
    this.inactivityMs = timeoutMs;
  }
}

/**
 * A per-stream inactivity watchdog.
 *
 * `arm()` returns a promise that rejects if nothing re-arms it before the
 * boundary elapses. The timer is re-armed only when an upstream item is actually
 * received, never because the consumer is looping or awaiting, so a slow consumer
 * cannot keep a dead stream alive.
 */
const createInactivityWatchdog = (timeoutMs) => {
  let timer = null;
  let rejectStall = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    rejectStall = null;
  };

  const arm = () =>
    new Promise((_, reject) => {
      if (timer !== null) clearTimeout(timer);
      rejectStall = reject;
      timer = setTimeout(() => {
        timer = null;
        rejectStall = null;
        reject(new AIProviderStreamTimeoutError(timeoutMs));
      }, timeoutMs);
      if (typeof timer?.unref === "function") timer.unref();
    });

  return { arm, clear };
};

/**
 * Wraps an already-open stream in an inactivity watchdog.
 *
 * The upstream may be a bare iterable or an async iterable; both are supported.
 * Cleanup covers every exit: normal completion, an upstream throw, a stall, and a
 * consumer that stops iterating early — the last of which closes the upstream
 * iterator when it supports `return()`.
 */
const boundedStream = (source, timeoutMs) => {
  const watchdog = createInactivityWatchdog(timeoutMs);
  const iterator = typeof source?.[Symbol.asyncIterator] === "function"
    ? source[Symbol.asyncIterator]()
    : source;

  return (async function* guarded() {
    try {
      while (true) {
        const stalled = watchdog.arm();
        // The watchdog promise is consumed by whichever race loses; swallow it so
        // a stall that is never awaited cannot become an unhandled rejection.
        stalled.catch(() => {});

        const step = await Promise.race([iterator.next(), stalled]);

        // An item arrived. The next wait is armed on the following iteration only
        // when the next item is actually awaited, so a slow consumer can never keep
        // a dead stream alive.
        if (step?.done) return step.value;
        yield step.value;
      }
    } finally {
      watchdog.clear();
      // A consumer that stopped early, or a stall, leaves the upstream iterator
      // open. Close it when the contract supports it, but deliberately do not
      // await the close: an upstream suspended inside its own `await` can make
      // `return()` never settle, and waiting for it would swallow the very
      // timeout this watchdog exists to report.
      if (iterator && typeof iterator.return === "function") {
        try {
          const closing = iterator.return();
          if (closing && typeof closing.catch === "function") closing.catch(() => {});
        } catch {
          // An iterator that cannot be closed is not a further failure.
        }
      }
    }
  })();
};

/**
 * Opens a provider stream under the same inactivity boundary, then hands back a
 * guarded iterator.
 *
 * The open is awaited rather than deferred, so a provider that fails to open
 * still rejects at the caller's `await`, exactly as it did before the watchdog
 * existed. Deferring that failure to iteration would move it from the tutor
 * controller's outer handler into its streaming catch, which would change the
 * HTTP response from an error status to an in-band error frame.
 */
const withStreamInactivityTimeout = async (openStream, timeoutMs) => {
  const watchdog = createInactivityWatchdog(timeoutMs);
  try {
    const stalled = watchdog.arm();
    stalled.catch(() => {});
    const source = await Promise.race([openStream, stalled]);
    return boundedStream(source, timeoutMs);
  } finally {
    watchdog.clear();
  }
};

/**
 * Applies the boundary to a provider.
 *
 * `complete` is bounded by total duration; `stream` is bounded by inactivity.
 * The two policies are independent and neither is applied to the other.
 */
const boundProvider = (provider) => ({
  complete: (request) => withCompletionTimeout(provider.complete(request), AI_COMPLETION_TIMEOUT_MS),
  stream: (request) => withStreamInactivityTimeout(provider.stream(request), AI_STREAM_INACTIVITY_TIMEOUT_MS),
});

let activeProvider = null;
let boundedProvider = null;

/** Replaces the active provider. Intended for tests and for future vendor swaps. */
export const setAIProvider = (provider) => {
  activeProvider = provider;
  boundedProvider = null;
};

/** Restores the default provider. Tests should call this between cases. */
export const resetAIProvider = () => {
  activeProvider = null;
  boundedProvider = null;
};

export const getAIProvider = () => {
  if (!activeProvider) activeProvider = createGroqProvider();
  if (!boundedProvider) boundedProvider = boundProvider(activeProvider);
  return boundedProvider;
};
