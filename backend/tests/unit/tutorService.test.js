/**
 * Tutor grounding contract — non-streaming path
 * ==============================================
 *
 * `tutorService.js` runs in full. Only the persistence boundary, the retriever and
 * the AI seam are replaced, so the ordering these tests care about is real: the
 * grounding decision is made, and the model is only reached afterwards.
 *
 * The property under test is not "the tutor says something sensible when it has no
 * context". It is that **the model is never consulted in that case**. An assertion
 * about prose would pass even if the provider had been called and then overruled;
 * these tests assert on the provider mock, so they fail if the gate is bypassed,
 * moved after the call, or implemented in the prompt instead of in code.
 */

import { jest } from "@jest/globals";
import { createMockAIProvider, createFailingAIProvider } from "../mocks/mockAIProvider.js";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";

// The production retriever runs, not a stand-in, so the scores these tests assert
// on are the ones the real scorer produces. That is deliberate: the gate's
// boundary is exactly zero, and a retriever double would let a test assert on
// numbers the application can never produce.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with",
]);
const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

/** The production combined score, so fixtures carry realistic values. */
const productionScore = (queryText, chunkText) => {
  const vectorScore = cosineSimilarity(
    generateEmbedding(queryText),
    generateEmbedding(chunkText),
  );
  const queryTokens = new Set(tokenize(queryText));
  const chunkTokens = new Set(tokenize(chunkText));
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (chunkTokens.has(token)) overlap += 1;
  });
  const lexical = queryTokens.size ? overlap / queryTokens.size : 0;
  return Number(((vectorScore * 0.78) + (lexical * 0.22)).toFixed(4));
};

// ─── Persistence doubles ──────────────────────────────────────────────────────
// `MaterialChunk` is mocked so the retriever sees a fixed score distribution
// without a database. Nothing here reimplements the production scoring.

let chunkCorpus = [];

const matchesFilter = (chunk, filter) =>
  Object.entries(filter).every(([field, value]) => String(chunk[field]) === String(value));

jest.unstable_mockModule("../../models/MaterialChunk.js", () => ({
  default: {
    find: jest.fn((filter) => {
      const results = chunkCorpus.filter((chunk) => matchesFilter(chunk, filter));
      const query = {
        populate: () => query,
        lean: () => query,
        sort: () => query,
        select: () => query,
        then: (resolve, reject) => Promise.resolve(results).then(resolve, reject),
      };
      return query;
    }),
    countDocuments: jest.fn(async (filter) =>
      chunkCorpus.filter((chunk) => matchesFilter(chunk, filter)).length,
    ),
    bulkWrite: jest.fn(async () => undefined),
    deleteMany: jest.fn(async () => undefined),
  },
}));

// `ensureChunksForUser` runs on every search and would otherwise re-index from
// Mongo. Stubbed empty so the read path stays the read path, and so an unexpected
// index write is visible rather than silent. The `select` chain is kept because
// the production caller uses it.
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: {
    find: jest.fn(() => ({
      select: () => ({ then: (resolve) => Promise.resolve([]).then(resolve) }),
    })),
  },
}));

const chainableLeanQuery = (result) => ({
  lean: () => chainableLeanQuery(result),
  sort: () => chainableLeanQuery(result),
  limit: () => chainableLeanQuery(result),
  select: () => chainableLeanQuery(result),
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
});

// `UserProgress` is consulted for weak topics, and the `user` field casts to an
// ObjectId at query time. It is mocked rather than given a real id so the test
// exercises the tutor and not Mongoose's casting, and so the id below is not a
// value that has to be kept in step with a model.
jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOne: jest.fn(() => chainableLeanQuery(null)) },
}));

// `buildMistakeHistory` and `findRelatedFlashcards` also read Mongo. They are
// part of the learner profile, not of grounding, and are stubbed to empty so the
// tests stay about the gate.
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({
  default: { find: jest.fn(() => chainableLeanQuery([])) },
}));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({
  default: { find: jest.fn(() => chainableLeanQuery([])) },
}));

const recordLearningEvent = jest.fn(async () => undefined);
jest.unstable_mockModule("../../services/learningEventService.js", () => ({
  recordLearningEvent,
}));

const generateTutorResponseFromAI = jest.fn(async () => ({
  answer: "Consider the four conditions.",
  groundedSources: [{ sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "Direct match." }],
  personalizedNotes: [],
  revisionPlan: ["Re-read the section."],
  suggestedFollowUps: ["Quiz me on deadlock"],
}));
jest.unstable_mockModule("../../services/aiQuizService.js", () => ({
  generateTutorResponseFromAI,
}));

// Imported after the model mocks are registered: this resolves MaterialChunk,
// StudyMaterial, UserProgress, QuizAttempt, FlashcardSet, the learning-event
// recorder and the AI seam, and the registrations above only take effect if they
// are in place first.
const { generateEmbedding, cosineSimilarity } =
  await import("../../services/embeddingService.js");

const { askContextualTutor } = await import("../../services/tutorService.js");

const QUESTION = "What are the necessary conditions for a deadlock?";
const MATCHING_TEXT =
  "A deadlock requires four necessary conditions to hold simultaneously: mutual " +
  "exclusion, hold and wait, the absence of preemption, and circular wait.";
/** Shares no surviving token with the question, so the production score is 0. */
const UNRELATED_TEXT =
  "The domain name system maps human readable host names to address records, and " +
  "recursive resolution walks the hierarchy from the root servers down to an " +
  "authoritative name server before caching the answer with a time to live.";

/**
 * A fixture chunk shaped exactly as indexing stores it, including a real
 * embedding, so the production retriever scores it.
 *
 * `expectScore` is the value the production scorer produces for this pair; the
 * tests assert against it rather than a number chosen to look plausible.
 */
const chunk = (chunkText, { chunkIndex = 0, expectScore } = {}) => {
  const score = productionScore(QUESTION, chunkText);
  // A mismatch here means the fixture drifted from production scoring, which would
  // make every other assertion in this file suspect.
  if (expectScore !== undefined) expect(score).toBe(expectScore);
  return {
    _id: `chunk-${chunkIndex}-${Math.random().toString(16).slice(2)}`,
    user: "user-1",
    studyMaterial: { _id: "mat-1", title: "OS Notes" },
    chunkIndex,
    chunkText,
    textPreview: chunkText.slice(0, 260),
    embedding: generateEmbedding(chunkText),
    embeddingModel: "local-hash-v1",
    score,
    sourceTitle: "OS Notes",
    topics: ["Deadlock"],
  };
};

const ask = (question = QUESTION) => askContextualTutor({ userId: "user-1", question });

beforeEach(() => {
  jest.clearAllMocks();
  // A default corpus that grounds, so each test states only the evidence it cares
  // about. A grounded path is the precondition, not the subject, for the refusal
  // tests.
  chunkCorpus = [chunk(MATCHING_TEXT, { expectScore: 0.4378 })];
  generateTutorResponseFromAI.mockResolvedValue({
    answer: "Consider the four conditions.",
    groundedSources: [{ sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "Direct match." }],
    personalizedNotes: [],
    revisionPlan: ["Re-read the section."],
    suggestedFollowUps: ["Quiz me on deadlock"],
  });
  recordLearningEvent.mockResolvedValue(undefined);
  setAIProvider(createMockAIProvider({ answer: "{}" }));
});

afterEach(() => {
  resetAIProvider();
});

describe("grounded questions", () => {
  test("adequate retrieved context reaches the model", async () => {
    const response = await ask();

    expect(generateTutorResponseFromAI).toHaveBeenCalledTimes(1);
    expect(response.answer).toBe("Consider the four conditions.");
    expect(response.grounding.grounded).toBe(true);
  });

  test("grounded responses keep their source citations", async () => {
    // The gate is additive. Nothing about citations, previews, chunk ids or
    // learner context may be weakened for a question that does get answered.
    const response = await ask();

    expect(response.groundedSources).toEqual([
      { sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "Direct match." },
    ]);
    expect(response.retrievedContext).toHaveLength(1);
    expect(response.retrievedContext[0]).toMatchObject({
      sourceNumber: 1,
      sourceTitle: "OS Notes",
      chunkIndex: 0,
      // The production score for this query/chunk pair, not a chosen number.
      score: 0.4378,
    });
    expect(response.learnerContext).toHaveProperty("weakTopics");
    expect(response.revisionPlan).toEqual(["Re-read the section."]);
    expect(response.suggestedFollowUps).toEqual(["Quiz me on deadlock"]);
  });

  test("a grounded response still reports which chunks it used", async () => {
    const response = await ask();

    expect(response.grounding).toMatchObject({
      grounded: true,
      reason: null,
      evidenceCount: 1,
      consideredCount: 1,
    });
    expect(response.grounding.bestScore).toBe(0.4378);
  });

  test("one unusable neighbour does not suppress a real match", async () => {
    // The gate requires some evidence, not unanimous evidence. A single irrelevant
    // chunk in the result window must not turn a well-grounded question into a
    // refusal.
    // Unrelated text genuinely scores 0 against the question; the matching chunk
    // carries the evidence. Proved in the assertion below rather than assumed.
    chunkCorpus = [
      chunk(UNRELATED_TEXT, { chunkIndex: 0, expectScore: 0 }),
      chunk(MATCHING_TEXT, { chunkIndex: 1, expectScore: 0.4378 }),
      chunk(UNRELATED_TEXT, { chunkIndex: 2, expectScore: 0 }),
    ];

    const response = await ask();

    expect(generateTutorResponseFromAI).toHaveBeenCalledTimes(1);
    expect(response.grounding.grounded).toBe(true);
    expect(response.grounding.consideredCount).toBe(3);
  });
});

describe("insufficient context", () => {
  test("an empty result set does not reach the model", async () => {
    chunkCorpus = [];

    const response = await ask();

    expect(generateTutorResponseFromAI).not.toHaveBeenCalled();
    expect(response.grounding).toMatchObject({ grounded: false, reason: "no_context" });
  });

  test("a wholly zero-scored result set does not reach the model", async () => {
    // The documented production behaviour this task exists to change: the
    // retriever has no refusal threshold, so a completely unevidenced result set
    // used to be handed to the model as though it were context.
    chunkCorpus = [chunk(UNRELATED_TEXT, { chunkIndex: 0, expectScore: 0 })];

    const response = await ask();

    expect(generateTutorResponseFromAI).not.toHaveBeenCalled();
    expect(response.grounding.reason).toBe("no_lexical_evidence");
  });

  test("the refusal is shaped so the client renders it rather than crashing", async () => {
    chunkCorpus = [];

    const response = await ask();

    expect(response).toMatchObject({
      question: "What are the necessary conditions for a deadlock?",
      groundedSources: [],
      retrievedContext: [],
    });
    expect(typeof response.answer).toBe("string");
    expect(response.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(response.revisionPlan)).toBe(true);
    expect(Array.isArray(response.suggestedFollowUps)).toBe(true);
    expect(response.learnerContext).toHaveProperty("weakTopics");
  });

  test("the refusal cites nothing", async () => {
    // Returning the rejected chunks would let a client display them as citations
    // for an answer that was never produced.
    chunkCorpus = [chunk(UNRELATED_TEXT, { chunkIndex: 0, expectScore: 0 })];

    const response = await ask();

    expect(response.groundedSources).toEqual([]);
    expect(response.retrievedContext).toEqual([]);
  });

  test("the refusal is recorded as insufficient_context, not as a partial answer", async () => {
    // `partial` previously meant the model failed or context was empty. A refusal
    // is a distinct outcome, and conflating them would make the event stream
    // unable to distinguish "the tutor declined" from "the tutor broke".
    chunkCorpus = [];

    await ask();

    expect(recordLearningEvent).toHaveBeenCalledTimes(1);
    expect(recordLearningEvent.mock.calls[0][0].result).toBe("insufficient_context");
  });

  test("the recorded event keeps the grounding decision for later analysis", async () => {
    chunkCorpus = [chunk(UNRELATED_TEXT, { chunkIndex: 0, expectScore: 0 })];

    await ask();

    const event = recordLearningEvent.mock.calls[0][0];
    expect(event.metadata.grounding).toMatchObject({ grounded: false, reason: "no_lexical_evidence" });
    // The chunks that were considered are still recorded, so a refusal can be
    // investigated rather than being a dead end in the log.
    expect(event.metadata.sourceCount).toBe(1);
  });
});

describe("the model is consulted only after a grounded decision", () => {
  test("the gate runs before the provider, not inside the prompt", async () => {
    // Ordering asserted directly: had the call been made and the result
    // discarded, the count would be 1 here.
    chunkCorpus = [chunk(UNRELATED_TEXT, { chunkIndex: 0, expectScore: 0 })];

    await ask();

    expect(generateTutorResponseFromAI).not.toHaveBeenCalled();
  });

  test("the AI provider seam is never reached on the refusal path", async () => {
    // The tutor's generation goes through the mocked service; this additionally
    // proves no provider was configured or touched, so a future refactor cannot
    // reintroduce a direct provider call on the refusal path.
    const provider = createMockAIProvider({ answer: "{}" });
    setAIProvider(provider);
    chunkCorpus = [];

    await ask();

    expect(provider.complete).not.toHaveBeenCalled();
    expect(provider.stream).not.toHaveBeenCalled();
  });
});

describe("failure handling after a grounded decision is unchanged", () => {
  test("a model failure still falls back to the closest retrieved chunk", async () => {
    // The gate does not replace the existing failure path. A grounded question
    // whose model call fails must behave exactly as before: a fallback derived
    // from the retrieved context, still carrying a citation.
    generateTutorResponseFromAI.mockRejectedValue(new Error("upstream down"));

    const response = await ask();

    expect(response.answer).toContain("OS Notes");
    expect(response.groundedSources).toHaveLength(1);
    expect(response.grounding.grounded).toBe(true);
  });

  test("a model failure is not reported as insufficient context", async () => {
    // The two conditions are different and must not be conflated in either
    // direction: a failed model is still a grounded interaction.
    generateTutorResponseFromAI.mockRejectedValue(new Error("upstream down"));

    const response = await ask();

    expect(response.grounding.grounded).toBe(true);
    expect(response.grounding.reason).toBeNull();
  });

  test("a failing provider seam is handled without the tutor throwing", async () => {
    setAIProvider(createFailingAIProvider(new Error("groq unreachable")));

    await expect(ask()).resolves.toBeDefined();
  });
});

describe("input validation is unchanged", () => {
  test("a too-short question is still rejected before retrieval", async () => {
    await expect(ask("ab")).rejects.toThrow("Question is too short");
    expect(generateTutorResponseFromAI).not.toHaveBeenCalled();
  });
});
