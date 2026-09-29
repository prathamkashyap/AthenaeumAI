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
} from "../mocks/mockAIProvider.js";
import {
  setAIProvider,
  getAIProvider,
  resetAIProvider,
  AIProviderTimeoutError,
  AI_COMPLETION_TIMEOUT_MS,
} from "../../services/aiProvider.js";

const MESSAGES = [{ role: "user", content: "hello" }];

const OK = { content: "a model response", usage: { totalTokens: 42 } };

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

  test("passes streaming straight through to the provider, unbounded", async () => {
    // Streaming needs an inactivity boundary rather than a total duration, and is
    // explicitly out of scope for this task. The provider is still the thing that
    // is called, and no completion timer is armed on its behalf.
    jest.useFakeTimers();
    const provider = createMockAIProvider([{ answer: "streamed" }]);
    setAIProvider(provider);

    const stream = await getAIProvider().stream({ messages: MESSAGES });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(provider.stream).toHaveBeenCalledWith({ messages: MESSAGES });
    expect(chunks.map((chunk) => chunk.content).join("")).toContain("streamed");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("does not subject a hanging stream to the completion boundary", async () => {
    // If the boundary were applied to streaming as well, a stream that never opens
    // would be rejected once the completion timeout elapsed. It must not be.
    jest.useFakeTimers();
    setAIProvider({
      complete: jest.fn(),
      stream: jest.fn(() => new Promise(() => {})),
    });

    const pending = getAIProvider().stream({ messages: MESSAGES });
    const outcome = await Promise.race([
      pending.then(() => "settled", () => "settled"),
      Promise.resolve("still-pending"),
    ]);

    expect(outcome).toBe("still-pending");

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS * 2);
    expect(await Promise.race([pending.then(() => "settled", () => "settled"), Promise.resolve("still-pending")]))
      .toBe("still-pending");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("re-arms the boundary when the provider is replaced", async () => {
    setAIProvider(createMockAIProvider([{ answer: "first" }]));
    await expect(getAIProvider().complete({ messages: MESSAGES })).resolves.toBeDefined();

    setAIProvider(createMockAIProvider([{ answer: "second" }]));

    await expect(getAIProvider().complete({ messages: MESSAGES }))
      .resolves.toEqual({ content: JSON.stringify([{ answer: "second" }]) });
  });
});
