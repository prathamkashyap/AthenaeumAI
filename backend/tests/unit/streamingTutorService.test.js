/**
 * Contract Tests — streamed tutoring against the provider seam
 *
 * `streamingTutorService.js` runs in full; only the model is replaced. The point
 * of interest is the shape the service hands to its consumer: the SDK's delta
 * chunks are translated into plain `{ content }` chunks by the provider layer, so
 * the HTTP layer no longer depends on a vendor's response shape.
 */

import { jest } from "@jest/globals";
import {
  createMockAIProvider,
  createFailingAIProvider,
  createStallingStreamProvider,
} from "../mocks/mockAIProvider.js";
import {
  setAIProvider,
  resetAIProvider,
  AI_STREAM_INACTIVITY_TIMEOUT_MS,
} from "../../services/aiProvider.js";

const { streamTutorResponse } = await import("../../services/streamingTutorService.js");

const ARGS = {
  question: "What is deadlock?",
  materialContexts: [
    { sourceTitle: "OS Notes", chunkIndex: 3, score: 0.82, chunkText: "Deadlock requires circular wait." },
    { sourceTitle: "Notes 2", chunkIndex: 7, score: 0.61, chunkText: "Coffman conditions." },
  ],
  weakTopics: [{ topic: "Deadlock", confidence: 20 }],
  mistakeHistory: [{ questionIndex: 1, topic: "Deadlock" }],
  flashcards: [{ front: "List the conditions.", back: "Mutual exclusion and more." }],
};

const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  resetAIProvider();
  jest.useRealTimers();
});

describe("streamTutorResponse", () => {
  test("asks the provider for a stream with the retrieved context in the prompt", async () => {
    const provider = createMockAIProvider({ answer: "Consider circular wait." });
    setAIProvider(provider);

    await streamTutorResponse(ARGS);

    const request = provider.stream.mock.calls[0][0];
    expect(request.model).toBe("llama-3.3-70b-versatile");
    expect(request.temperature).toBe(0.2);
    expect(request.maxTokens).toBe(2500);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("Socratic");

    const prompt = request.messages[1].content;
    expect(prompt).toContain("[SOURCE 1]");
    expect(prompt).toContain("[SOURCE 2]");
    expect(prompt).toContain("OS Notes");
    expect(prompt).toContain("Deadlock requires circular wait.");
    expect(prompt).toContain("Coffman conditions.");
    expect(prompt).toContain("Deadlock");
  });

  test("emits plain content chunks the consumer can concatenate", async () => {
    setAIProvider(createMockAIProvider({ answer: "Start with circular wait." }));

    const chunks = await collect(await streamTutorResponse(ARGS));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Object.keys(chunk)).toEqual(["content"]);
      expect(typeof chunk.content).toBe("string");
    }
    expect(chunks.map((c) => c.content).join("")).toBe(JSON.stringify({ answer: "Start with circular wait." }));
  });

  test("emits nothing for an empty body", async () => {
    setAIProvider(createMockAIProvider(""));

    await expect(collect(await streamTutorResponse(ARGS))).resolves.toEqual([]);
  });

  test("does not call the provider when nothing was retrieved", async () => {
    // This replaced a test asserting the opposite. It previously pinned the
    // behaviour that the provider WAS asked to handle empty context, with
    // "No matching uploaded material chunks were found." interpolated into the
    // prompt and the model left to decide whether that was enough to answer.
    //
    // That is not a grounding contract: the model was consulted about whether it
    // had evidence, and could answer anyway. The decision now happens in code,
    // before the provider is touched, and a refusal is returned as a stream so
    // the HTTP layer needs no change.
    const provider = createMockAIProvider({ answer: "No matching material." });
    setAIProvider(provider);

    const chunks = await collect(await streamTutorResponse({ ...ARGS, materialContexts: [] }));

    expect(provider.stream).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
    // Still a well-formed SSE body, so the controller's iteration and `[DONE]`
    // are unchanged and a refusal cannot surface as a client error.
    expect(chunks).toHaveLength(1);
    const payload = JSON.parse(chunks[0].content);
    expect(payload.grounding).toMatchObject({ grounded: false, reason: "no_context", streamed: true });
    expect(payload.groundedSources).toEqual([]);
  });

  test("does not call the non-streaming completion path", async () => {
    const provider = createMockAIProvider({ answer: "x" });
    setAIProvider(provider);

    await streamTutorResponse(ARGS);

    expect(provider.complete).not.toHaveBeenCalled();
  });

  test("propagates a provider failure to open the stream", async () => {
    setAIProvider(createFailingAIProvider(new Error("tutor upstream down")));

    await expect(streamTutorResponse(ARGS)).rejects.toThrow("tutor upstream down");
  });

  test("a stalling stream is terminated by the seam instead of hanging", async () => {
    // The production chain: streamingTutorService -> provider seam -> injected
    // stalling provider -> inactivity timeout. Before the watchdog existed this
    // loop waited forever and the HTTP response was never completed.
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({ content: "Hello", count: 2, then: "stall" }));

    let settled = null;
    const chunks = [];
    const pending = (async () => {
      const stream = await streamTutorResponse(ARGS);
      for await (const chunk of stream) chunks.push(chunk.content);
    })().then(
      () => { settled = "resolved"; },
      (error) => { settled = error.code || error.message; },
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(chunks.length).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(AI_STREAM_INACTIVITY_TIMEOUT_MS - 1);
    expect(settled).toBeNull();

    await jest.advanceTimersByTimeAsync(2);

    expect(settled).toBe("AI_PROVIDER_STREAM_TIMEOUT");
    // The chunks that did arrive are still delivered to the consumer.
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("Hello");
    expect(jest.getTimerCount()).toBe(0);

    await pending;
  });

  test("a stream that opens but never produces anything is terminated", async () => {
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({ count: 0, then: "stall" }));

    let settled = null;
    (async () => {
      const stream = await streamTutorResponse(ARGS);
      for await (const chunk of stream) void chunk.content;
    })().then(
      () => { settled = "resolved"; },
      (error) => { settled = error.code; },
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toBeNull();

    await jest.advanceTimersByTimeAsync(AI_STREAM_INACTIVITY_TIMEOUT_MS + 2);

    expect(settled).toBe("AI_PROVIDER_STREAM_TIMEOUT");
  });

  test("a healthy stream keeps delivering past the inactivity duration", async () => {
    // Tutors answer slowly. A stream that keeps producing must not be killed just
    // because it has been alive longer than the inactivity window.
    jest.useFakeTimers();
    setAIProvider(createStallingStreamProvider({
      content: "part",
      count: 4,
      then: "end",
      gap: AI_STREAM_INACTIVITY_TIMEOUT_MS / 2,
    }));

    const chunks = [];
    const pending = (async () => {
      const stream = await streamTutorResponse(ARGS);
      for await (const chunk of stream) chunks.push(chunk.content);
    })();

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(2 * AI_STREAM_INACTIVITY_TIMEOUT_MS);
    await pending;

    expect(chunks).toHaveLength(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  // ─── The grounding gate ─────────────────────────────────────────────────────
  //
  // The same four cases as the non-streaming suite, because the point of the
  // contract is that the two paths cannot disagree. If these ever diverge, one of
  // them is deciding something the other does not.

  test("grounds and streams normally when at least one chunk carries evidence", async () => {
    const provider = createMockAIProvider({ answer: "Consider circular wait." });
    setAIProvider(provider);

    const chunks = await collect(await streamTutorResponse(ARGS));

    expect(provider.stream).toHaveBeenCalledTimes(1);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("one unusable neighbour does not suppress a real match", async () => {
    // Matches the non-streaming rule: some evidence grounds, not unanimity.
    const provider = createMockAIProvider({ answer: "Consider circular wait." });
    setAIProvider(provider);

    const chunks = await collect(await streamTutorResponse({
      ...ARGS,
      materialContexts: [
        { sourceTitle: "Irrelevant", chunkIndex: 0, score: 0, chunkText: "Unrelated passage." },
        { sourceTitle: "OS Notes", chunkIndex: 3, score: 0.41, chunkText: "Deadlock requires circular wait." },
      ],
    }));

    expect(provider.stream).toHaveBeenCalledTimes(1);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("a wholly zero-scored result set never reaches the provider", async () => {
    const provider = createMockAIProvider({ answer: "Guess." });
    setAIProvider(provider);

    const chunks = await collect(await streamTutorResponse({
      ...ARGS,
      materialContexts: [
        { sourceTitle: "A", chunkIndex: 0, score: 0, chunkText: "Unrelated." },
        { sourceTitle: "B", chunkIndex: 1, score: 0, chunkText: "Also unrelated." },
      ],
    }));

    expect(provider.stream).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    const payload = JSON.parse(chunks[0].content);
    expect(payload.grounding.reason).toBe("no_lexical_evidence");
  });

  test("the refusal payload matches the non-streaming refusal", async () => {
    // Both paths hand the client one document. If the wording or shape drifted,
    // the same question would be refused differently depending on transport.
    const provider = createMockAIProvider({ answer: "unused" });
    setAIProvider(provider);

    const chunks = await collect(await streamTutorResponse({ ...ARGS, materialContexts: [] }));
    const streamed = JSON.parse(chunks[0].content);

    const {
      evaluateTutorGrounding,
      insufficientContextResponse,
    } = await import("../../services/tutorGrounding.js");
    const expected = insufficientContextResponse({
      question: ARGS.question,
      grounding: { ...evaluateTutorGrounding([]), streamed: true },
    });

    expect(streamed.answer).toBe(expected.answer);
    expect(streamed.groundedSources).toEqual(expected.groundedSources);
    expect(streamed.retrievedContext).toEqual(expected.retrievedContext);
    expect(streamed.revisionPlan).toEqual(expected.revisionPlan);
    expect(streamed.suggestedFollowUps).toEqual(expected.suggestedFollowUps);
  });

  test("the refusal does not claim the model was consulted", async () => {
    // A streamed refusal that said "I could not answer" would imply a generation
    // attempt that never happened.
    setAIProvider(createMockAIProvider({ answer: "unused" }));

    const chunks = await collect(await streamTutorResponse({ ...ARGS, materialContexts: [] }));
    const payload = JSON.parse(chunks[0].content);

    expect(payload.answer).toMatch(/could not find anything/i);
    expect(payload.answer).not.toMatch(/\bI (?:could not|cannot) (?:answer|help)\b/i);
  });

  test("a refusal still terminates as a normal stream rather than throwing", async () => {
    // The controller writes `[DONE]` after iteration and treats a throw as a
    // transport error. A refusal must not take either branch.
    setAIProvider(createMockAIProvider({ answer: "unused" }));

    const stream = await streamTutorResponse({ ...ARGS, materialContexts: [] });
    const seen = [];
    await expect((async () => {
      for await (const chunk of stream) seen.push(chunk.content);
    })()).resolves.toBeUndefined();

    expect(seen).toHaveLength(1);
  });

  test("propagates a failure raised part way through the stream", async () => {
    const provider = createMockAIProvider({ answer: "x" });
    provider.stream = jest.fn(async function* stream() {
      yield { content: "partial" };
      throw new Error("stream interrupted");
    });
    setAIProvider(provider);

    const stream = await streamTutorResponse(ARGS);
    const seen = [];
    await expect((async () => {
      for await (const chunk of stream) seen.push(chunk.content);
    })()).rejects.toThrow("stream interrupted");

    // Whatever was delivered before the failure is retained, so the controller
    // can report the partial answer rather than discarding it silently.
    expect(seen).toEqual(["partial"]);
  });
});
