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
 * This module also owns the one runtime guarantee every non-streaming
 * completion has: it is bounded in time. The boundary is applied here, at the
 * seam, rather than in each service, so a new AI feature inherits it for free and
 * a provider that never resolves can never hold a request open indefinitely.
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
 * Applies the boundary to a provider.
 *
 * `complete` is bounded. `stream` is passed straight through: streaming needs an
 * inactivity boundary rather than a total duration, which is a separate concern.
 */
const boundProvider = (provider) => ({
  complete: (request) => withCompletionTimeout(provider.complete(request), AI_COMPLETION_TIMEOUT_MS),
  stream: (request) => provider.stream(request),
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
