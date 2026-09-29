/**
 * Contract Tests — the non-streaming AI timeout boundary
 *
 * `aiProvider.js` owns the one runtime guarantee every non-streaming completion
 * has: it is bounded in time. These tests pin that boundary itself — the duration,
 * the error, the timer lifecycle and concurrency — using injected providers, so
 * they run offline with no API key and no network.
 *
 * The production-bound chain, in which a real AI service is driven by a hanging
 * provider all the way through the seam to the fallback, is covered in
 * `aiQuizService.test.js` and `mistakeAnalysisService.test.js`.
 */

import { jest } from "@jest/globals";
import {
  createMockAIProvider,
  createFailingAIProvider,
  createHangingAIProvider,
  createStallingStreamProvider,
} from "../mocks/mockAIProvider.js";
import {
  setAIProvider,
  getAIProvider,
  resetAIProvider,
  AIProviderTimeoutError,
  AIProviderStreamTimeoutError,
  AI_COMPLETION_TIMEOUT_MS,
  AI_STREAM_INACTIVITY_TIMEOUT_MS,
} from "../../services/aiProvider.js";

const MESSAGES = [{ role: "user", content: "hello" }];

const OK = { content: "a model response", usage: { totalTokens: 42 } };

/**
 * Starts consuming a stream and records how it ended.
 *
 * The bounded stream is an async iterable rather than a promise, so consumption is
 * driven by a real `for await`, and settlement is observed through an explicit
 * flag rather than a `Promise.race` against an already-resolved sentinel, which
 * would be racy under fake timers.
 */
const trackStream = (streamPromise) => {
  const state = { chunks: [], settled: null };

  state.done = (async () => {
    const stream = await streamPromise;
    for await (const chunk of stream) state.chunks.push(chunk);
    return state.chunks;
  })().then(
    (value) => { state.settled = { status: "resolved", value }; },
    (error) => { state.settled = { status: "rejected", error }; },
  );

  return state;
};

/** Advances fake timers and lets the microtask queue drain. */
const advance = async (ms) => {
  await jest.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  resetAIProvider();
  jest.useRealTimers();
});

describe("the timeout boundary", () => {
  test("is a single named, documented value", () => {
    expect(AI_COMPLETION_TIMEOUT_MS).toBe(30_000);
  });

  test("returns the provider result unchanged on success", async () => {
    const provider = createMockAIProvider([{ answer: "x" }]);
    setAIProvider(provider);

    const result = await getAIProvider().complete({ messages: MESSAGES });

    // Exactly the provider's own object: the boundary adds no wrapping,
    // coercion or extra fields on the way through.
    expect(result).toEqual({ content: JSON.stringify([{ answer: "x" }]) });
    expect(provider.complete).toHaveBeenCalledWith({ messages: MESSAGES });
  });

  test("propagates a provider rejection unchanged", async () => {
    setAIProvider(createFailingAIProvider(new Error("rate limited")));

    await expect(getAIProvider().complete({ messages: MESSAGES }))
      .rejects.toThrow("rate limited");
  });

  test("a provider that never settles rejects with the timeout error", async () => {
    jest.useFakeTimers();
    setAIProvider(createHangingAIProvider());

    const pending = getAIProvider().complete({ messages: MESSAGES });
    const settled = pending.then(
      (value) => ({ status: "resolved", value }),
      (error) => ({ status: "rejected", error }),
    );

    // Still pending just before the boundary: the request is bounded, not
    // resolved early, and not rejected early either.
    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS - 1);
    expect(await Promise.race([settled, Promise.resolve("still-pending")]))
      .toBe("still-pending");

    await jest.advanceTimersByTimeAsync(1);
    const outcome = await settled;

    expect(outcome.status).toBe("rejected");
    expect(outcome.error).toBeInstanceOf(AIProviderTimeoutError);
    expect(outcome.error.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(outcome.error.message).toBe("AI provider did not respond within 30000ms");
    expect(outcome.error.timeoutMs).toBe(AI_COMPLETION_TIMEOUT_MS);
  });

  test("the timeout error carries no provider internals", () => {
    const error = new AIProviderTimeoutError(AI_COMPLETION_TIMEOUT_MS);

    // Own fields are limited to identification and the configured boundary.
    expect(Object.keys(error).sort()).toEqual(["code", "name", "timeoutMs"]);
    expect(error.message).not.toMatch(/groq|api[_-]?key|token|socket/i);
    expect(error).not.toHaveProperty("statusCode");
  });

  test("is a purpose-built error type, not a repurposed built-in", () => {
    // A timeout is an operational failure, not a programming mistake. Subclassing
    // a built-in such as TypeError would misreport it in logs and error grouping,
    // and every `catch` in the AI services would still treat it identically, so
    // nothing else would reveal the mistake.
    const error = new AIProviderTimeoutError(AI_COMPLETION_TIMEOUT_MS);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AIProviderTimeoutError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(SyntaxError);
  });

  test("clears its timer when the request succeeds", async () => {
    jest.useFakeTimers();
    setAIProvider(createMockAIProvider([{ answer: "x" }]));

    await expect(getAIProvider().complete({ messages: MESSAGES })).resolves.toBeDefined();

    // Nothing is left pending: a stray timer would either keep the process alive
    // or fire a rejection nobody is listening for.
    expect(jest.getTimerCount()).toBe(0);
  });

  test("clears its timer when the request fails", async () => {
    jest.useFakeTimers();
    setAIProvider(createFailingAIProvider(new Error("upstream down")));

    await expect(getAIProvider().complete({ messages: MESSAGES })).rejects.toThrow("upstream down");

    expect(jest.getTimerCount()).toBe(0);
  });

  test("leaves no timer behind after a timeout has fired", async () => {
    jest.useFakeTimers();
    setAIProvider(createHangingAIProvider());

    const pending = getAIProvider().complete({ messages: MESSAGES });
    const settled = pending.catch((error) => error);

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS);
    expect((await settled).code).toBe("AI_PROVIDER_TIMEOUT");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("concurrent requests have independent timeout lifecycles", async () => {
    jest.useFakeTimers();

    // One call resolves promptly, the other hangs. Each must be bounded on its
    // own terms rather than sharing a single deadline.
    const prompt = createMockAIProvider([{ answer: "quick" }]);
    const hanging = createHangingAIProvider();
    const wrapper = {
      complete: jest.fn((request) => (
        request.messages[0].content === "quick"
          ? prompt.complete(request)
          : hanging.complete(request)
      )),
      stream: jest.fn(),
    };
    setAIProvider(wrapper);

    const quick = getAIProvider().complete({ messages: [{ role: "user", content: "quick" }] });
    const slow = getAIProvider().complete({ messages: [{ role: "user", content: "hang" }] });
    const slowOutcome = slow.catch((error) => error);

    // Two timers, one per in-flight request.
    expect(jest.getTimerCount()).toBe(2);

    await expect(quick).resolves.toEqual({ content: JSON.stringify([{ answer: "quick" }]) });

    // The quick request released only its own timer.
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS);

    expect((await slowOutcome).code).toBe("AI_PROVIDER_TIMEOUT");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("applies the boundary to whichever provider is installed", async () => {
    // The boundary belongs to the seam, not to one implementation, so a swapped
    // or injected provider is bounded identically.
    const injected = createHangingAIProvider();
    setAIProvider(injected);

    expect(getAIProvider()).not.toBe(injected);
    expect(getAIProvider().complete).not.toBe(injected.complete);
  });

  test("passes a healthy stream through unchanged", async () => {
    const provider = createMockAIProvider([{ answer: "streamed" }]);
    setAIProvider(provider);

    const stream = await getAIProvider().stream({ messages: MESSAGES });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    // Same normalized shape the seam has always produced: no SDK objects.
    expect(provider.stream).toHaveBeenCalledWith({ messages: MESSAGES });
    expect(chunks.map((chunk) => chunk.content).join("")).toContain("streamed");
    for (const chunk of chunks) expect(Object.keys(chunk)).toEqual(["content"]);
  });

  test("a healthy stream arms no timer once it has finished", async () => {
    jest.useFakeTimers();
    const provider = createStallingStreamProvider({ count: 3, then: "end" });
    setAIProvider(provider);

    const stream = await getAIProvider().stream({ messages: MESSAGES });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toHaveLength(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("times out when the stream never yields its first chunk", async () => {
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({ count: 0, then: "stall" }));

    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    // Let the stream start so its watchdog is armed from t=0.
    await advance(0);
    await advance(AI_STREAM_INACTIVITY_TIMEOUT_MS - 1);
    expect(state.settled).toBeNull();

    await advance(2);
    expect(state.settled.status).toBe("rejected");
    expect(state.settled.error).toBeInstanceOf(AIProviderStreamTimeoutError);
    expect(state.settled.error.code).toBe("AI_PROVIDER_STREAM_TIMEOUT");
    expect(state.settled.error.inactivityMs).toBe(AI_STREAM_INACTIVITY_TIMEOUT_MS);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("times out when the stream itself never opens", async () => {
    // The wait for the stream handle is an upstream request too, so it is bounded
    // by the same inactivity rule.
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({ openNever: true }));

    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    await advance(0);
    await advance(AI_STREAM_INACTIVITY_TIMEOUT_MS - 1);
    expect(state.settled).toBeNull();

    await advance(2);
    expect(state.settled.status).toBe("rejected");
    expect(state.settled.error.code).toBe("AI_PROVIDER_STREAM_TIMEOUT");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("times out only after the inactivity window following the last chunk", async () => {
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({ content: "c", count: 2, then: "stall" }));

    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    await advance(0);
    expect(state.chunks).toHaveLength(2);

    // Not yet: the arrival of the second chunk reset the window.
    await advance(AI_STREAM_INACTIVITY_TIMEOUT_MS - 1);
    expect(state.settled).toBeNull();

    await advance(2);
    expect(state.settled.status).toBe("rejected");
    expect(state.settled.error.code).toBe("AI_PROVIDER_STREAM_TIMEOUT");
    // Both chunks were still delivered before the stall.
    expect(state.chunks).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("each chunk resets the inactivity window", async () => {
    jest.useFakeTimers();
    // One item every half-interval: three windows elapse in total, well beyond the
    // inactivity boundary, yet the stream survives because each item reset it.
    setAIProvider(createStallingStreamProvider({
      content: "c",
      count: 3,
      then: "end",
      gap: AI_STREAM_INACTIVITY_TIMEOUT_MS / 2,
    }));

    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    await advance(0);
    for (let i = 0; i < 3; i += 1) {
      await advance(AI_STREAM_INACTIVITY_TIMEOUT_MS / 2 - 1);
      // At no point may the watchdog have killed it: the only acceptable end
      // states mid-flight are "still going" or, on the last window, "finished".
      expect(state.settled?.error?.code).not.toBe("AI_PROVIDER_STREAM_TIMEOUT");
      await advance(2);
      expect(state.chunks).toHaveLength(i + 1);
    }

    // Three half-windows is 1.5x the inactivity boundary, and it completed.
    expect(state.settled.status).toBe("resolved");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a continuously producing stream is never killed for being long", async () => {
    jest.useFakeTimers();
    // One item every half-interval for four intervals: the total lifetime is
    // roughly twice the inactivity boundary, so a total-duration limit would have
    // terminated this healthy stream.
    setAIProvider(createStallingStreamProvider({
      content: "tok",
      count: 4,
      then: "end",
      gap: AI_STREAM_INACTIVITY_TIMEOUT_MS / 2,
    }));

    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    await advance(2 * AI_STREAM_INACTIVITY_TIMEOUT_MS);

    expect(state.settled.status).toBe("resolved");
    expect(state.chunks).toHaveLength(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a stream that throws clears the watchdog and propagates the error", async () => {
    jest.useFakeTimers();
    setAIProvider({
      complete: jest.fn(),
      stream: jest.fn(() => (async function* stream() {
        yield { content: "partial" };
        throw new Error("upstream reset");
      })()),
    });

    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    await advance(0);

    expect(state.settled.status).toBe("rejected");
    expect(state.settled.error.message).toBe("upstream reset");
    expect(state.chunks).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a consumer stopping early closes the upstream iterator and clears the watchdog", async () => {
    jest.useFakeTimers();
    let released = 0;
    setAIProvider({
      complete: jest.fn(),
      stream: jest.fn(() => (async function* stream() {
        try {
          yield { content: "one" };
          yield { content: "two" };
          await new Promise(() => {});
        } finally {
          released += 1;
        }
      })()),
    });

    const stream = await getAIProvider().stream({ messages: MESSAGES });
    for await (const chunk of stream) {
      expect(chunk.content).toBe("one");
      break;
    }

    // The upstream generator's own cleanup ran, so the stream is not left open.
    expect(released).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("concurrent streams have independent watchdogs", async () => {
    jest.useFakeTimers();
    setAIProvider({
      complete: jest.fn(),
      stream: jest.fn((request) => {
        const stalling = request.messages[0].content === "stall";
        return (async function* stream() {
          yield { content: "first" };
          if (stalling) await new Promise(() => {});
          else yield { content: "second" };
        })();
      }),
    });

    const open = (content) => getAIProvider().stream({ messages: [{ role: "user", content }] });
    const healthy = trackStream(open("ok"));
    const stalled = trackStream(open("stall"));

    await advance(0);
    // The healthy stream finished on its own; the stalled one is still waiting.
    expect(healthy.settled.status).toBe("resolved");
    expect(healthy.chunks).toEqual([{ content: "first" }, { content: "second" }]);
    expect(stalled.settled).toBeNull();

    await advance(AI_STREAM_INACTIVITY_TIMEOUT_MS);

    // Only the stalled stream was terminated.
    expect(stalled.settled.status).toBe("rejected");
    expect(stalled.settled.error.code).toBe("AI_PROVIDER_STREAM_TIMEOUT");
    expect(healthy.settled.status).toBe("resolved");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("the two policies stay independent", async () => {
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({ content: "c", count: 2, then: "end", gap: 1000 }));

    // Streaming is not wrapped in the completion boundary: a stream that runs for
    // longer than the completion timeout is untouched by it.
    const state = trackStream(getAIProvider().stream({ messages: MESSAGES }));

    await advance(AI_COMPLETION_TIMEOUT_MS);

    expect(state.settled.status).toBe("resolved");
    expect(state.chunks).toHaveLength(2);
  });

  test("the stream timeout error is distinct and carries no provider internals", () => {
    const streamError = new AIProviderStreamTimeoutError(AI_STREAM_INACTIVITY_TIMEOUT_MS);

    expect(streamError).toBeInstanceOf(Error);
    expect(streamError).toBeInstanceOf(AIProviderStreamTimeoutError);
    expect(streamError).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(streamError.code).toBe("AI_PROVIDER_STREAM_TIMEOUT");
    expect(Object.keys(streamError).sort()).toEqual(["code", "inactivityMs", "name"]);
    expect(streamError.message).not.toMatch(/groq|api[_-]?key|socket|0x/i);
    expect(streamError).not.toHaveProperty("statusCode");
  });

  test("re-arms the boundary when the provider is replaced", async () => {
    setAIProvider(createMockAIProvider([{ answer: "first" }]));
    await expect(getAIProvider().complete({ messages: MESSAGES })).resolves.toBeDefined();

    setAIProvider(createMockAIProvider([{ answer: "second" }]));

    await expect(getAIProvider().complete({ messages: MESSAGES }))
      .resolves.toEqual({ content: JSON.stringify([{ answer: "second" }]) });
  });
});
