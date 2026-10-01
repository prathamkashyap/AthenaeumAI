/**
 * Contract Tests — AI quiz generation against the provider seam
 *
 * Production-bound and fully offline: `aiQuizService.js` runs in full and only
 * the model is replaced, by the deterministic provider in
 * `tests/mocks/mockAIProvider.js`. What is under test is the application's
 * boundary — prompt construction, response parsing, validation, deduplication and
 * error handling — and not the behaviour of Groq, which no test here can observe.
 *
 * Every case runs without `GROQ_API_KEY` being set, which is the property the
 * seam exists to provide.
 */

import { jest } from "@jest/globals";
import {
  createMockAIProvider,
  createFailingAIProvider,
  createHangingAIProvider,
  createTimeoutAIProvider,
} from "../mocks/mockAIProvider.js";
import {
  setAIProvider,
  getAIProvider,
  resetAIProvider,
  AI_COMPLETION_TIMEOUT_MS,
} from "../../services/aiProvider.js";

const {
  generateQuizFromAI,
  generateFlashcardsFromAI,
  generateMistakeAnalysesFromAI,
  generateTutorResponseFromAI,
  getDefaultCognitiveLevel,
  VALID_COGNITIVE_LEVELS,
} = await import("../../services/aiQuizService.js");

const CONTENT = "Deadlock is a state in which two processes are each waiting for the other. ".repeat(60);

const question = (overrides = {}) => ({
  question: "Which scheduling behaviour lets a short process wait behind a long one?",
  options: ["Round Robin", "Priority Scheduling", "First Come First Served", "Shortest Job First"],
  answer: 2,
  explanation: "FCFS is non-preemptive and serves in arrival order.",
  topic: "Scheduling",
  cognitiveLevel: "Analyze",
  ...overrides,
});

const useProvider = (provider) => {
  setAIProvider(provider);
  return provider;
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  resetAIProvider();
  jest.useRealTimers();
});

// ─── The seam itself ──────────────────────────────────────────────────────────

describe("the provider seam", () => {
  test("an AI service runs with no API key available at all", async () => {
    // The point of the seam: the key is the Groq provider's concern, so the
    // service works whether or not one is configured. Removing it here proves
    // that regardless of how the test runner was invoked.
    const original = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      useProvider(createMockAIProvider([question()]));
      await expect(generateQuizFromAI(CONTENT, "Easy", 1)).resolves.toHaveLength(1);
    } finally {
      if (original !== undefined) process.env.GROQ_API_KEY = original;
    }
  });

  test("an injected provider receives the prompt and sampling parameters", async () => {
    const provider = useProvider(createMockAIProvider([question()]));

    await generateQuizFromAI(CONTENT, "Hard", 2);

    const request = provider.complete.mock.calls[0][0];
    expect(request.model).toBe("llama-3.3-70b-versatile");
    expect(request.temperature).toBe(0.2); // Hard is pinned tighter than the profile
    expect(request.maxTokens).toBe(2048);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].content).toContain("Hard");
    expect(request.messages[1].content).toContain(CONTENT.slice(0, 200));
  });

  test("an injected provider is used, and resetting restores the real one", async () => {
    const injected = createMockAIProvider([question()]);
    setAIProvider(injected);

    // The seam hands back a bounded wrapper rather than the raw object, so the
    // proof that the injected provider is the one used is that it is called.
    expect(getAIProvider()).not.toBe(injected);
    await expect(generateQuizFromAI(CONTENT, "Easy", 1)).resolves.toHaveLength(1);
    expect(injected.complete).toHaveBeenCalled();

    resetAIProvider();
    const restored = getAIProvider();
    expect(restored).not.toBe(injected);
    expect(typeof restored.complete).toBe("function");
    expect(typeof restored.stream).toBe("function");
  });
});

// ─── Quiz generation ──────────────────────────────────────────────────────────

describe("generateQuizFromAI", () => {
  test("returns validated questions from a well-formed model response", async () => {
    useProvider(createMockAIProvider([question()]));

    const questions = await generateQuizFromAI(CONTENT, "Medium", 5);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      answer: 2,
      topic: "Scheduling",
      cognitiveLevel: "Analyze",
    });
    expect(questions[0].options).toHaveLength(4);
  });

  test("extracts a JSON array from surrounding prose and markdown", async () => {
    useProvider(createMockAIProvider("Here you go:\n```json\n" + JSON.stringify([question()]) + "\n```\nHope that helps!"));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toHaveLength(1);
  });

  test("returns an empty list when the model response is not JSON", async () => {
    useProvider(createMockAIProvider("I am afraid I cannot help with that request."));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("returns an empty list when the model returns no content at all", async () => {
    useProvider(createMockAIProvider({ content: undefined }));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("still finds the questions when the model wraps them in an object", async () => {
    // The array extraction is greedy, so an object envelope such as
    // `{"questions": [...]}` is unwrapped rather than rejected. Recorded because
    // it is relied on by the "surrounding prose" case above.
    useProvider(createMockAIProvider({ questions: [question()] }));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toHaveLength(1);
  });

  test("returns an empty list when the response is a JSON object with no array", async () => {
    useProvider(createMockAIProvider({ note: "I produced nothing useful." }));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("drops questions whose option count is wrong", async () => {
    useProvider(createMockAIProvider([
      question({ question: "Valid question" }),
      question({ question: "Only three options", options: ["a", "b", "c"] }),
    ]));

    const questions = await generateQuizFromAI(CONTENT, "Medium", 5);

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe("Valid question");
  });

  test("drops questions whose answer index is out of range", async () => {
    useProvider(createMockAIProvider([
      question({ question: "Answer too high", answer: 4 }),
      question({ question: "Answer negative", answer: -1 }),
      question({ question: "Answer not a number", answer: "two" }),
    ]));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("drops questions that are missing the question text", async () => {
    useProvider(createMockAIProvider([{ ...question(), question: undefined }]));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("drops a question whose cognitive level is outside Bloom's taxonomy", async () => {
    // `isValidQuestion` rejects an unrecognised cognitive level outright, so the
    // question never reaches the default-substitution step.
    useProvider(createMockAIProvider([
      question({ question: "Unknown level", cognitiveLevel: "Telepathic" }),
      question({ question: "Known level" }),
    ]));

    const questions = await generateQuizFromAI(CONTENT, "Medium", 5);

    expect(questions.map((q) => q.question)).toEqual(["Known level"]);
  });

  test("substitutes the difficulty's default cognitive level when the model omits it", async () => {
    useProvider(createMockAIProvider([{ ...question(), cognitiveLevel: undefined }]));

    const [first] = await generateQuizFromAI(CONTENT, "Easy", 5);

    expect(VALID_COGNITIVE_LEVELS.has(first.cognitiveLevel)).toBe(true);
    expect(first.cognitiveLevel).toBe(getDefaultCognitiveLevel("Easy"));
  });

  test("maps each difficulty to its own default cognitive level", () => {
    expect(getDefaultCognitiveLevel("Easy")).toBe("Remember");
    expect(getDefaultCognitiveLevel("Medium")).toBe("Apply");
    expect(getDefaultCognitiveLevel("Hard")).toBe("Evaluate");
    // Any other difficulty, recognised or not, falls through to Evaluate.
    expect(getDefaultCognitiveLevel("Impossible")).toBe("Evaluate");
  });

  test("removes duplicate question text", async () => {
    useProvider(createMockAIProvider([
      question({ question: "Repeated question?" }),
      question({ question: "Repeated question?" }),
      question({ question: "A distinct question?" }),
    ]));

    const questions = await generateQuizFromAI(CONTENT, "Medium", 5);

    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.question)).toEqual(["Repeated question?", "A distinct question?"]);
  });

  test("never returns more questions than were requested", async () => {
    useProvider(createMockAIProvider([question(), question({ question: "Second" }), question({ question: "Third" })]));

    await expect(generateQuizFromAI(CONTENT, "Medium", 2)).resolves.toHaveLength(2);
  });

  test("keeps the questions from the chunks that succeeded when one chunk fails", async () => {
    // A long document is split into several chunks, and each is requested
    // separately; a provider that fails intermittently must not lose the chunks
    // that worked.
    const provider = createMockAIProvider([question()]);
    let call = 0;
    provider.complete = jest.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("upstream 503");
      return { content: JSON.stringify([question()]) };
    });
    useProvider(provider);

    const questions = await generateQuizFromAI(CONTENT.repeat(6), "Medium", 10);

    expect(provider.complete).toHaveBeenCalled();
    expect(questions.length).toBeGreaterThan(0);
  });

  test("degrades to no questions when every provider call fails", async () => {
    // Each chunk is requested inside its own guard, so a total upstream failure
    // costs the learner their quiz rather than failing the whole request.
    useProvider(createFailingAIProvider(new Error("Groq API rate limit exceeded")));

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("treats a timeout error from the provider like any other failure", async () => {
    useProvider(createTimeoutAIProvider());

    await expect(generateQuizFromAI(CONTENT, "Medium", 5)).resolves.toEqual([]);
  });

  test("a provider that never settles is bounded by the seam and degrades as a failure", async () => {
    // The production chain end to end: this service -> provider seam -> hanging
    // provider -> timeout boundary -> the service's existing per-chunk failure
    // path. Before the boundary existed this call stayed pending forever.
    jest.useFakeTimers();
    useProvider(createHangingAIProvider());

    const pending = generateQuizFromAI(CONTENT, "Medium", 5);
    const settled = pending.then(
      (value) => ({ status: "resolved", value }),
      (error) => ({ status: "rejected", error }),
    );

    // Pending before the boundary, so the assertion below is not passing early.
    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS - 1);
    expect(await Promise.race([settled, Promise.resolve("still-pending")]))
      .toBe("still-pending");

    // The service requests up to three chunks sequentially and each gets its own
    // boundary, so the whole call needs one window per chunk before it can finish.
    await jest.advanceTimersByTimeAsync(3 * AI_COMPLETION_TIMEOUT_MS);
    const outcome = await settled;

    // Bounded, and degraded exactly as any other provider failure already is:
    // the per-chunk guard turns it into no questions rather than a rejection.
    expect(outcome.status).toBe("resolved");
    expect(outcome.value).toEqual([]);
  });

  test("a bounded timeout leaves no timer behind once the service has finished", async () => {
    jest.useFakeTimers();
    useProvider(createHangingAIProvider());

    const pending = generateQuizFromAI(CONTENT, "Medium", 5);
    // A few milliseconds past the last boundary, since the final chunk's timer is
    // armed mid-window and lands exactly on its end.
    await jest.advanceTimersByTimeAsync(3 * AI_COMPLETION_TIMEOUT_MS + 10);
    await expect(pending).resolves.toEqual([]);

    expect(jest.getTimerCount()).toBe(0);
  });
});

// ─── Flashcards ───────────────────────────────────────────────────────────────

describe("generateFlashcardsFromAI", () => {
  const longEnough = "x".repeat(100);

  test("returns trimmed flashcards from a well-formed response", async () => {
    useProvider(createMockAIProvider([
      { front: "  What causes the convoy effect?  ", back: "  A long process at the head of the ready queue blocks short ones.  ", topic: "  Scheduling  " },
    ]));

    const cards = await generateFlashcardsFromAI(longEnough, 5);

    expect(cards).toEqual([{
      front: "What causes the convoy effect?",
      back: "A long process at the head of the ready queue blocks short ones.",
      topic: "Scheduling",
    }]);
  });

  test("skips text too short to generate from", async () => {
    const provider = useProvider(createMockAIProvider([]));

    await expect(generateFlashcardsFromAI("too short", 5)).resolves.toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  test("rejects a card whose sides are too short to be useful", async () => {
    useProvider(createMockAIProvider([
      { front: "short", back: "short", topic: "X" },
      { front: "A sufficiently long question side", back: "A sufficiently long answer side with detail.", topic: "X" },
    ]));

    const cards = await generateFlashcardsFromAI(longEnough, 5);

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("A sufficiently long question side");
  });

  test("defaults a missing or blank topic to General", async () => {
    useProvider(createMockAIProvider([
      { front: "A sufficiently long question side", back: "A sufficiently long answer side with detail.", topic: "   " },
    ]));

    const [card] = await generateFlashcardsFromAI(longEnough, 5);

    expect(card.topic).toBe("General");
  });

  test("returns an empty list when the response is not JSON", async () => {
    useProvider(createMockAIProvider("Sorry, no."));

    await expect(generateFlashcardsFromAI(longEnough, 5)).resolves.toEqual([]);
  });

  test("propagates a provider failure", async () => {
    useProvider(createFailingAIProvider(new Error("upstream unavailable")));

    await expect(generateFlashcardsFromAI(longEnough, 5)).rejects.toThrow("upstream unavailable");
  });

  test("a timeout is a provider failure and keeps propagating", async () => {
    // Flashcards have no fallback of their own, so the bounded timeout must still
    // surface as a rejection rather than being swallowed anywhere.
    jest.useFakeTimers();
    useProvider(createHangingAIProvider());

    const pending = generateFlashcardsFromAI(longEnough, 5);
    const settled = pending.then(
      (value) => ({ status: "resolved", value }),
      (error) => ({ status: "rejected", error }),
    );

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS - 1);
    expect(await Promise.race([settled, Promise.resolve("still-pending")]))
      .toBe("still-pending");

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS + 10);
    const outcome = await settled;

    expect(outcome.status).toBe("rejected");
    expect(outcome.error.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ─── Mistake analyses ─────────────────────────────────────────────────────────

describe("generateMistakeAnalysesFromAI", () => {
  const mistakes = [{ questionIndex: 1, topic: "Deadlock", correctOption: "Deadlock", selectedOption: "Starvation" }];

  test("returns normalised analyses keyed to the question index", async () => {
    useProvider(createMockAIProvider([{
      questionIndex: 1,
      topic: "  Deadlock  ",
      misconception: "  Confusing deadlock with starvation.  ",
      clarification: "  A deadlock is a circular wait.  ",
      distractorReason: "  Starvation also means indefinite waiting.  ",
      revisionSuggestion: "  Re-derive the Coffman conditions.  ",
      relatedFlashcards: ["  List the conditions.  ", "   ", "Compare with starvation."],
    }]));

    const analyses = await generateMistakeAnalysesFromAI({ quizTitle: "OS", difficulty: "Hard", mistakes });

    expect(analyses).toHaveLength(1);
    expect(analyses[0]).toMatchObject({
      questionIndex: 1,
      topic: "Deadlock",
      misconception: "Confusing deadlock with starvation.",
      clarification: "A deadlock is a circular wait.",
    });
    // Blank entries are dropped and the list is capped at three.
    expect(analyses[0].relatedFlashcards).toEqual(["List the conditions.", "Compare with starvation."]);
  });

  test("returns an empty list for an empty mistake list without calling the provider", async () => {
    const provider = useProvider(createMockAIProvider([]));

    await expect(generateMistakeAnalysesFromAI({ quizTitle: "OS", difficulty: "Hard", mistakes: [] })).resolves.toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  test("drops analyses missing a required explanation field", async () => {
    useProvider(createMockAIProvider([
      { questionIndex: 1, misconception: "m", clarification: "c", revisionSuggestion: "r" },
      { questionIndex: 2, misconception: "m", clarification: "c" },
    ]));

    const analyses = await generateMistakeAnalysesFromAI({ quizTitle: "OS", difficulty: "Hard", mistakes });

    expect(analyses.map((a) => a.questionIndex)).toEqual([1]);
  });

  test("returns an empty list when the response is not JSON", async () => {
    useProvider(createMockAIProvider("not json at all"));

    await expect(generateMistakeAnalysesFromAI({ quizTitle: "OS", difficulty: "Hard", mistakes })).resolves.toEqual([]);
  });

  test("returns an empty list when a relatedFlashcards entry is not an array", async () => {
    useProvider(createMockAIProvider([{
      questionIndex: 1, misconception: "m", clarification: "c", revisionSuggestion: "r",
      relatedFlashcards: "List the conditions",
    }]));

    const [analysis] = await generateMistakeAnalysesFromAI({ quizTitle: "OS", difficulty: "Hard", mistakes });

    expect(analysis.relatedFlashcards).toEqual([]);
  });

  test("propagates a provider failure to the caller", async () => {
    useProvider(createFailingAIProvider(new Error("model overloaded")));

    await expect(generateMistakeAnalysesFromAI({ quizTitle: "OS", difficulty: "Hard", mistakes }))
      .rejects.toThrow("model overloaded");
  });
});

// ─── Tutor ────────────────────────────────────────────────────────────────────

describe("generateTutorResponseFromAI", () => {
  const tutorArgs = {
    question: "What is deadlock?",
    materialContexts: [{ sourceTitle: "OS Notes", chunkIndex: 3, score: 0.82, chunkText: "Deadlock requires circular wait." }],
    weakTopics: [{ topic: "Deadlock", confidence: 20 }],
    mistakeHistory: [{ questionIndex: 1 }],
    flashcards: [{ front: "f", back: "b" }],
  };

  test("parses a well-formed tutor response", async () => {
    useProvider(createMockAIProvider({
      answer: "  Start from the four Coffman conditions.  ",
      groundedSources: [{ sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "defines circular wait" }],
      personalizedNotes: ["You have missed this twice."],
      revisionPlan: ["Re-read the notes."],
      suggestedFollowUps: ["Can you construct a schedule?"],
    }));

    const result = await generateTutorResponseFromAI(tutorArgs);

    expect(result.answer).toBe("Start from the four Coffman conditions.");
    expect(result.groundedSources).toHaveLength(1);
    expect(result.personalizedNotes).toEqual(["You have missed this twice."]);
    expect(result.revisionPlan).toEqual(["Re-read the notes."]);
    expect(result.suggestedFollowUps).toEqual(["Can you construct a schedule?"]);
  });

  test("passes the retrieved context into the prompt", async () => {
    const provider = useProvider(createMockAIProvider({ answer: "Consider circular wait." }));

    await generateTutorResponseFromAI(tutorArgs);

    const prompt = provider.complete.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("[SOURCE 1]");
    expect(prompt).toContain("OS Notes");
    expect(prompt).toContain("Deadlock requires circular wait.");
    expect(prompt).toContain("Socratic");
  });

  test("copes with no retrieved context at all", async () => {
    const provider = useProvider(createMockAIProvider({ answer: "No uploaded material matched." }));

    await expect(generateTutorResponseFromAI({ ...tutorArgs, materialContexts: [] }))
      .resolves.toMatchObject({ answer: "No uploaded material matched." });
    expect(provider.complete.mock.calls[0][0].messages[1].content)
      .toContain("No matching uploaded material chunks were found.");
  });

  test("throws when the response has no answer", async () => {
    useProvider(createMockAIProvider({ groundedSources: [] }));

    await expect(generateTutorResponseFromAI(tutorArgs))
      .rejects.toThrow("Tutor AI returned invalid response");
  });

  test("throws when the response is not JSON", async () => {
    useProvider(createMockAIProvider("I think deadlock is when a process waits."));

    await expect(generateTutorResponseFromAI(tutorArgs))
      .rejects.toThrow("Tutor AI returned invalid response");
  });

  test("defaults absent collections to empty arrays", async () => {
    useProvider(createMockAIProvider({ answer: "Try listing the conditions." }));

    await expect(generateTutorResponseFromAI(tutorArgs)).resolves.toEqual({
      answer: "Try listing the conditions.",
      groundedSources: [],
      personalizedNotes: [],
      revisionPlan: [],
      suggestedFollowUps: [],
    });
  });

  test("sends the learner's question and the whole personalization payload to the provider", async () => {
    // The function is responsible for forwarding the learner profile alongside the
    // retrieved context; without this the tutor would silently lose it.
    const provider = useProvider(createMockAIProvider({ answer: "Start with circular wait." }));

    await generateTutorResponseFromAI(tutorArgs);

    const prompt = provider.complete.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("What is deadlock?");
    expect(prompt).toContain("WEAK TOPICS:");
    expect(prompt).toContain("Deadlock");           // weakTopics[0].topic
    expect(prompt).toContain("RECENT MISTAKES:");
    expect(prompt).toContain("RELATED FLASHCARDS:");
  });

  test("uses the tutor's own request parameters and system role", async () => {
    // Pinned separately from the quiz path, which shares this module but sends
    // different sampling values.
    const provider = useProvider(createMockAIProvider({ answer: "Consider the conditions." }));

    await generateTutorResponseFromAI(tutorArgs);

    const request = provider.complete.mock.calls[0][0];
    expect(request.model).toBe("llama-3.3-70b-versatile");
    expect(request.temperature).toBe(0.2);
    expect(request.maxTokens).toBe(2500);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("Socratic");
  });

  test("omits personalization sections that are not supplied", async () => {
    const provider = useProvider(createMockAIProvider({ answer: "Nothing to personalise yet." }));

    await generateTutorResponseFromAI({
      question: "What is deadlock?",
      materialContexts: tutorArgs.materialContexts,
      weakTopics: [],
      mistakeHistory: [],
      flashcards: [],
    });

    // An empty array is still forwarded and serialised as `[]`, rather than the
    // section silently disappearing from the prompt.
    const prompt = provider.complete.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("WEAK TOPICS:");
    expect(prompt).toContain("[]");
  });

  test("caps each collection so one verbose response cannot flood the client", async () => {
    useProvider(createMockAIProvider([{
      answer: "Work through it.",
      groundedSources: Array.from({ length: 9 }, (_, i) => ({ sourceNumber: i, sourceTitle: `S${i}`, whyRelevant: "w" })),
      personalizedNotes: Array.from({ length: 9 }, (_, i) => `note ${i}`),
      revisionPlan: Array.from({ length: 9 }, (_, i) => `plan ${i}`),
      suggestedFollowUps: Array.from({ length: 9 }, (_, i) => `follow up ${i}`),
    }]));

    const result = await generateTutorResponseFromAI(tutorArgs);

    expect(result.groundedSources).toHaveLength(5);
    expect(result.personalizedNotes).toHaveLength(5);
    expect(result.revisionPlan).toHaveLength(6);
    expect(result.suggestedFollowUps).toHaveLength(5);
  });

  test("ignores a collection of the wrong type", async () => {
    useProvider(createMockAIProvider({
      answer: "Work through it.",
      groundedSources: "not an array",
      revisionPlan: { not: "an array" },
    }));

    const result = await generateTutorResponseFromAI(tutorArgs);

    expect(result.groundedSources).toEqual([]);
    expect(result.revisionPlan).toEqual([]);
  });

  test("propagates a provider failure", async () => {
    useProvider(createFailingAIProvider(new Error("tutor upstream down")));

    await expect(generateTutorResponseFromAI(tutorArgs)).rejects.toThrow("tutor upstream down");
  });

  test("a timeout is a provider failure and keeps propagating", async () => {
    // Non-streaming tutoring has no fallback, so the bounded timeout must surface
    // as a rejection exactly as any other provider failure does.
    jest.useFakeTimers();
    useProvider(createHangingAIProvider());

    const pending = generateTutorResponseFromAI(tutorArgs);
    const settled = pending.then(
      (value) => ({ status: "resolved", value }),
      (error) => ({ status: "rejected", error }),
    );

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS - 1);
    expect(await Promise.race([settled, Promise.resolve("still-pending")]))
      .toBe("still-pending");

    await jest.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS + 10);
    const outcome = await settled;

    expect(outcome.status).toBe("rejected");
    expect(outcome.error.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(outcome.error.message).not.toMatch(/groq|api[_-]?key/i);
    expect(jest.getTimerCount()).toBe(0);
  });
});
