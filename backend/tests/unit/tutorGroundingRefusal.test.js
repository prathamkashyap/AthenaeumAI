/**
 * Tutor grounding refusal — the refusal must survive its own telemetry
 * ================================================================
 *
 * A learner asks something the indexed material does not cover. The tutor is
 * supposed to decline, honestly, and say so. That refusal was being destroyed
 * twice over:
 *
 *   1. `recordLearningEvent` was called with `result: "insufficient_context"`,
 *      a value absent from the `LearningEvent.result` enum. Mongoose rejected it,
 *      the error handler mapped ValidationError to HTTP 400
 *      ("Database validation failed"), and the learner saw a database error
 *      instead of the refusal. Every refusal branch in the UI was unreachable.
 *
 *   2. That write was awaited, unguarded, *before* the refusal was returned, so
 *      any failure in it replaced a correct answer to the learner's question with
 *      an error response.
 *
 * The pre-existing suite in `tutorService.test.js` mocked `learningEventService`
 * and asserted only the argument handed to the mock, so the value never reached
 * a schema and the disagreement was invisible. These tests therefore assert the
 * model itself, and drive the recorder's failure mode directly.
 *
 * The property under test is not the refusal's wording. It is that **refusing is
 * a correct outcome that cannot be turned into an error**.
 */

import { jest } from "@jest/globals";
import { createMockAIProvider } from "../mocks/mockAIProvider.js";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";

// The real model, imported unmocked, so the enum is checked as declared rather
// than as assumed. This is the assertion that was missing when the bug shipped.
const { default: LearningEvent } = await import("../../models/LearningEvent.js");

// ─── Persistence doubles ──────────────────────────────────────────────────────
// Only the retrieval and learner-profile reads are replaced. The refusal under
// test is produced by the production grounding gate over an empty evidence set.

const chainableLeanQuery = (data) => {
  const query = {
    sort: () => query,
    limit: () => query,
    skip: () => query,
    select: () => query,
    populate: () => query,
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
  };
  return query;
};

let chunkCorpus = [];

const matchesFilter = (chunk, filter) =>
  Object.entries(filter).every(([field, value]) => String(chunk[field]) === String(value));

jest.unstable_mockModule("../../models/MaterialChunk.js", () => ({
  default: {
    find: jest.fn((filter) => {
      const results = chunkCorpus.filter((chunk) => matchesFilter(chunk, filter));
      return chainableLeanQuery(results);
    }),
    countDocuments: jest.fn(async (filter) =>
      chunkCorpus.filter((chunk) => matchesFilter(chunk, filter)).length,
    ),
    bulkWrite: jest.fn(async () => undefined),
    deleteMany: jest.fn(async () => undefined),
  },
}));

// `ensureChunksForUser` runs on every search and would otherwise re-index from
// Mongo. Stubbed empty so the read path stays the read path; the `select` chain is
// kept because the production caller uses it.
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: {
    find: jest.fn(() => ({
      select: () => ({ then: (resolve) => Promise.resolve([]).then(resolve) }),
    })),
  },
}));
jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOne: jest.fn(() => chainableLeanQuery(null)) },
}));
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

const { generateEmbedding } = await import("../../services/embeddingService.js");
const { askContextualTutor } = await import("../../services/tutorService.js");

const USER_ID = "507f1f77bcf86cd799439011";
const QUESTION = "What are the necessary conditions for a deadlock?";
const MATCHING_TEXT =
  "A deadlock requires four necessary conditions to hold simultaneously: mutual " +
  "exclusion, hold and wait, the absence of preemption, and circular wait.";

/**
 * Shaped exactly as indexing stores it, including a real embedding, so the
 * production retriever scores it. A fixture without a real embedding would score
 * zero and silently turn every "grounded" case into a refusal.
 */
const groundedChunk = (text, index = 0) => ({
  _id: `chunk-${index}`,
  user: USER_ID,
  studyMaterial: { _id: "material-1", title: "OS Notes" },
  chunkIndex: index,
  chunkText: text,
  textPreview: text.slice(0, 260),
  embedding: generateEmbedding(text),
  embeddingModel: "local-hash-v1",
  score: 1,
  sourceTitle: "OS Notes",
  topics: ["Deadlock"],
});

/** No evidence at all: the production gate refuses on an absent result set. */
const withNoEvidence = () => {
  chunkCorpus = [];
};
const withEvidence = () => {
  chunkCorpus = [groundedChunk(MATCHING_TEXT)];
};

const ask = () => askContextualTutor({ userId: USER_ID, question: QUESTION });

beforeEach(() => {
  jest.clearAllMocks();
  withNoEvidence();
  recordLearningEvent.mockResolvedValue(undefined);
  generateTutorResponseFromAI.mockResolvedValue({
    answer: "Consider the four conditions.",
    groundedSources: [{ sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "Direct match." }],
    personalizedNotes: [],
    revisionPlan: ["Re-read the section."],
    suggestedFollowUps: ["Quiz me on deadlock"],
  });
  setAIProvider(createMockAIProvider());
});

afterEach(() => {
  resetAIProvider();
});

// ─── A. The model accepts the value the service writes ────────────────────────

describe("the LearningEvent schema accepts a grounding refusal", () => {
  const attempt = (overrides = {}) =>
    new LearningEvent({
      user: USER_ID,
      topic: "Deadlock",
      eventType: "ai_tutoring_interaction",
      result: "insufficient_context",
      confidence: 0,
      difficulty: "",
      metadata: { question: QUESTION },
      ...overrides,
    });

  test("insufficient_context is an allowed result", async () => {
    await expect(attempt().validate()).resolves.toBeUndefined();
  });

  test("it is listed among the enum values", () => {
    expect(LearningEvent.schema.path("result").enumValues).toContain("insufficient_context");
  });

  test("the previously valid results are still allowed", () => {
    const allowed = LearningEvent.schema.path("result").enumValues;
    for (const value of ["correct", "incorrect", "completed", "partial", "skipped", "reviewed"]) {
      expect(allowed).toContain(value);
    }
  });

  test("the default is unchanged", () => {
    expect(LearningEvent.schema.path("result").defaultValue).toBe("completed");
  });

  test("a genuinely unknown result is still rejected", async () => {
    await expect(attempt({ result: "not_a_real_outcome" }).validate()).rejects.toThrow();
  });

  test("the refusal's metadata shape validates", async () => {
    await expect(
      attempt({
        metadata: {
          question: QUESTION,
          materialId: null,
          retrievedChunkIds: [],
          sourceCount: 0,
          grounding: { grounded: false, reason: "no_context", consideredCount: 0 },
        },
      }).validate(),
    ).resolves.toBeUndefined();
  });
});

// ─── B. The refusal still says what it is meant to say ───────────────────────

describe("the refusal reaches the learner intact", () => {
  test("it resolves rather than throwing", async () => {
    await expect(ask()).resolves.toBeDefined();
  });

  test("it is marked ungrounded with a reason", async () => {
    const response = await ask();
    expect(response.grounding).toMatchObject({ grounded: false, reason: "no_context" });
  });

  test("it cites nothing", async () => {
    const response = await ask();
    expect(response.groundedSources).toEqual([]);
    expect(response.retrievedContext).toEqual([]);
  });

  test("it carries the shape the client renders", async () => {
    const response = await ask();
    for (const key of [
      "question",
      "answer",
      "groundedSources",
      "personalizedNotes",
      "revisionPlan",
      "suggestedFollowUps",
    ]) {
      expect(response).toHaveProperty(key);
    }
  });

  test("the learner context is still attached", async () => {
    const response = await ask();
    expect(response.learnerContext).toBeDefined();
  });

  test("the model is never consulted", async () => {
    await ask();
    expect(generateTutorResponseFromAI).not.toHaveBeenCalled();
  });
});

// ─── C. A failing telemetry write cannot become a failing response ────────────

describe("the refusal does not depend on the analytics write succeeding", () => {
  test("a write that rejects still yields the refusal", async () => {
    recordLearningEvent.mockRejectedValue(new Error("Database validation failed"));

    const response = await ask();
    expect(response.grounding).toMatchObject({ grounded: false, reason: "no_context" });
  });

  test("a write that rejects never propagates to the caller", async () => {
    recordLearningEvent.mockRejectedValue(new Error("Database validation failed"));
    await expect(ask()).resolves.toBeDefined();
  });

  test("a synchronous-looking throw is also contained", async () => {
    recordLearningEvent.mockImplementation(() => {
      throw new Error("schema rejected the value");
    });

    await expect(ask()).resolves.toBeDefined();
  });

  test("a write returning null, its documented early exit, is not a failure", async () => {
    // `recordLearningEvent` returns `null` rather than a promise when it declines
    // to record. Calling `.catch` on that would itself throw, so the guard must
    // not be implemented as a promise chain.
    recordLearningEvent.mockReturnValue(null);

    await expect(ask()).resolves.toBeDefined();
  });

  test("the refusal is still complete after a failed write", async () => {
    recordLearningEvent.mockRejectedValue(new Error("write failed"));

    const response = await ask();
    expect(response.answer).toBeTruthy();
    expect(response.groundedSources).toEqual([]);
    expect(response.revisionPlan.length).toBeGreaterThan(0);
  });
});

// ─── D/E. Recording behaviour and the answering path ──────────────────────────

describe("the refusal is still recorded when the write succeeds", () => {
  test("it is recorded as insufficient_context rather than a partial answer", async () => {
    await ask();

    expect(recordLearningEvent).toHaveBeenCalledTimes(1);
    expect(recordLearningEvent.mock.calls[0][0].result).toBe("insufficient_context");
  });

  test("the recorded event carries the refusal's grounding metadata", async () => {
    await ask();

    const event = recordLearningEvent.mock.calls[0][0];
    expect(event.eventType).toBe("ai_tutoring_interaction");
    expect(event.metadata.question).toBe(QUESTION);
    expect(event.metadata.grounding).toMatchObject({ grounded: false });
  });

  test("the grounding gate itself is untouched by the guard", async () => {
    recordLearningEvent.mockRejectedValue(new Error("write failed"));
    await ask();

    // The refusal is still a refusal, not a degraded grounded answer.
    expect(generateTutorResponseFromAI).not.toHaveBeenCalled();
  });
});

describe("a grounded question is unaffected", () => {
  test("the model is consulted and the answer returned", async () => {
    withEvidence();
    const response = await ask();

    expect(generateTutorResponseFromAI).toHaveBeenCalledTimes(1);
    expect(response.answer).toBe("Consider the four conditions.");
  });

  test("it is recorded as a completed interaction", async () => {
    withEvidence();
    await ask();

    expect(recordLearningEvent.mock.calls[0][0].result).toBe("completed");
  });

  test("its citations survive", async () => {
    withEvidence();
    const response = await ask();

    expect(response.groundedSources).toHaveLength(1);
    expect(response.retrievedContext).toHaveLength(1);
  });

  test("a grounded answer still fails loudly if its own write rejects", async () => {
    // Deliberately asserted so the guard's scope is explicit: it was added to the
    // refusal path only, and the answering path's write remains unguarded.
    withEvidence();
    recordLearningEvent.mockRejectedValue(new Error("write failed"));

    await expect(ask()).rejects.toThrow("write failed");
  });
});
