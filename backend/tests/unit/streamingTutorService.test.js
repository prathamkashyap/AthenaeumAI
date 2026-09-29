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
} from "../mocks/mockAIProvider.js";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";

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

  test("states plainly when no material context was retrieved", async () => {
    const provider = createMockAIProvider({ answer: "No matching material." });
    setAIProvider(provider);

    await streamTutorResponse({ ...ARGS, materialContexts: [] });

    expect(provider.stream.mock.calls[0][0].messages[1].content)
      .toContain("No matching uploaded material chunks were found.");
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
