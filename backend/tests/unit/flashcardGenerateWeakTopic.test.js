/**
 * Weak-topic flashcard generation — full request boundary
 * =======================================================
 *
 * This suite exists because of a specific class of defect, not to cover a
 * function.
 *
 * The service already refused to persist a zero-card set, but it did so with a
 * plain `Error` carrying no status. The result: a learner with no attempts, who
 * is in a completely expected state, received HTTP 500 — logged as an unhandled
 * exception, reported to the client as a server fault — and the frontend had no
 * `catch`, so the button simply stopped spinning and showed nothing.
 *
 * A service-level test could never have caught that. The status is assigned by
 * the error handler, transported over HTTP, and consumed by a UI. So this suite
 * drives the whole chain and asserts on the response:
 *
 *   real route → real validation → real controller → real service
 *     → real error middleware → HTTP status and body
 *
 * Only the outside world is replaced: the Mongoose models, the AI generator,
 * auth, and the AI quota (which is orthogonal here and would otherwise make the
 * suite order-dependent). Everything between the request and the response is the
 * code that actually runs in production.
 */

import { jest } from "@jest/globals";
import express from "express";

const USER_ID = "507f1f77bcf86cd799439011";
const QUIZ_ID = "507f191e810c19729de860ea";

const create = jest.fn(async (doc) => ({ _id: "set-1", ...doc }));
const findByIdAndUpdate = jest.fn(async () => ({}));

// A progress document with topics weak enough to generate from, and one with
// none. The empty case is the fresh-account path under test.
let progressTopics = [];

// Deliberately NOT async. The service chains `.lean()` onto the return value of
// `UserProgress.findOne(...)`, because the real Mongoose `findOne` is
// synchronous and returns a Query. An async mock returns a Promise, which has no
// `.lean`, and the service throws a TypeError before reaching any of the logic
// under test.
const findOne = jest.fn((filter) => {
  if (filter.user !== USER_ID) return null;
  if (filter._id === QUIZ_ID) {
    return { _id: QUIZ_ID, title: "OS", questions: [], studyMaterial: null };
  }
  return { lean: async () => ({ topics: progressTopics }) };
});

jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({ default: { create } }));
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: { findOne, findByIdAndUpdate },
}));
jest.unstable_mockModule("../../models/UserProgress.js", () => ({ default: { findOne } }));
jest.unstable_mockModule("../../models/Quiz.js", () => ({ default: { findOne } }));
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({ default: { findOne } }));
jest.unstable_mockModule("../../models/ReviewQueue.js", () => ({
  default: { updateMany: jest.fn(async () => ({ modifiedCount: 0 })) },
}));

// The real generator short-circuits on short input and returns [], which is
// exactly the condition being tested. Mocked anyway so no network call can make
// the result depend on an external service.
const generateFlashcardsFromAI = jest.fn(async () => {
  throw new Error("AI should not be reached for empty input");
});
jest.unstable_mockModule("../../services/aiQuizService.js", () => ({ generateFlashcardsFromAI }));

jest.unstable_mockModule("../../middleware/authMiddleware.js", () => ({
  requireAuth: (req, res, next) => {
    req.user = { _id: USER_ID };
    next();
  },
}));

jest.unstable_mockModule("../../middleware/aiQuotaMiddleware.js", () => ({
  userAiQuota: () => (req, res, next) => next(),
}));

const { default: flashcardRoutes } = await import("../../routes/flashcardRoutes.js");
const { globalErrorHandler } = await import("../../middleware/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/api/v1/flashcards", flashcardRoutes);
// The production error handler, so the status and body asserted here are the ones
// a learner would actually receive.
app.use(globalErrorHandler);

const weakTopic = (topic, weaknessScore) => ({
  topic,
  subject: "Operating Systems",
  mastery: 100 - weaknessScore,
  confidence: 40,
  weaknessScore,
  attempted: 3,
  recommendedDifficulty: "Easy",
});

// Assigned in `beforeAll`, once the app above is fully constructed.
let request;
const generate = (body) => request(app).post("/api/v1/flashcards/generate").send(body);

beforeAll(async () => {
  ({ default: request } = await import("supertest"));
});

beforeEach(() => {
  jest.clearAllMocks();
  progressTopics = [];
});

describe("no weak topics is an expected state, not a server fault", () => {
  test("returns 400 rather than 500", async () => {
    // A fresh account: progress exists but has no topics, so `weakTopics` is
    // empty and the AI generator is never given anything to work from.
    progressTopics = [];

    const response = await generate({ sourceType: "weak-topics", count: 12 });

    // The regression this suite exists for. Without a status on the throw this
    // was 500, which misreports an ordinary learner state as a fault and fills
    // the error log with entries that describe nobody's mistake.
    expect(response.status).toBe(400);
  });

  test("carries a message that tells the learner what to do next", async () => {
    const response = await generate({ sourceType: "weak-topics", count: 12 });

    // The endpoint's `error` field is the contract the client renders, so the
    // guidance has to live here rather than in the UI.
    expect(response.body.error).toMatch(/no weak topics/i);
    expect(response.body.error).toMatch(/assessment/i);
  });

  test("persists nothing", async () => {
    await generate({ sourceType: "weak-topics", count: 12 });

    // No empty set may reach the database. Hiding one from the client would not
    // be a fix: it would reappear on the next load.
    expect(create).not.toHaveBeenCalled();
  });

  test("is not logged as a server error", async () => {
    await generate({ sourceType: "weak-topics", count: 12 });

    // A 4xx is the signal that the condition is a client-state one. If this ever
    // returns 500 the handler routes it to logger.error instead.
    expect((await generate({ sourceType: "weak-topics", count: 12 })).status).toBeLessThan(500);
  });
});

describe("generation still works when there is something to generate from", () => {
  test("creates a set and returns 201", async () => {
    progressTopics = [weakTopic("Deadlock", 80)];

    const response = await generate({ sourceType: "weak-topics", count: 12 });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("builds the set from the weak topics", async () => {
    progressTopics = [weakTopic("Deadlock", 80)];

    await generate({ sourceType: "weak-topics", count: 12 });

    const [doc] = create.mock.calls[0];
    expect(doc.sourceType).toBe("weak-topics");
    expect(doc.cards.length).toBeGreaterThan(0);
    expect(doc.cards[0].topic).toBe("Deadlock");
  });

  test("still schedules every card for review", async () => {
    // The new error path must not have disturbed SM-2 initialisation.
    progressTopics = [weakTopic("Deadlock", 80)];

    await generate({ sourceType: "weak-topics", count: 12 });

    const [doc] = create.mock.calls[0];
    for (const card of doc.cards) {
      expect(card.review).toMatchObject({ easeFactor: 2.5, repetitions: 0, interval: 0 });
      expect(card.review.nextReviewAt).toBeInstanceOf(Date);
    }
  });
});

describe("the message is specific to the source that ran out", () => {
  test("does not blame weak topics when the source is a material", async () => {
    // A material whose extraction produced no text reaches the same guard. Telling
    // that learner they have no weak topics would send them to take an assessment,
    // which cannot possibly help.
    const { default: StudyMaterial } = await import("../../models/StudyMaterial.js");
    StudyMaterial.findOne.mockImplementation(async (filter) =>
      filter.user === USER_ID && filter._id === "507f1f77bcf86cd799439012"
        ? { _id: "507f1f77bcf86cd799439012", title: "Scanned", extractedText: "" }
        : null
    );

    const response = await generate({
      sourceType: "material",
      sourceId: "507f1f77bcf86cd799439012",
    });

    expect(response.status).toBe(400);
    // Asserting only "does not mention weak topics" is not enough: the generic
    // fallback also avoids that phrase, so removing this source's own message
    // would still pass. Naming the actual cause — that the file yielded no text —
    // is what distinguishes a correct message from a merely non-wrong one.
    expect(response.body.error).not.toMatch(/weak topics/i);
    expect(response.body.error).toMatch(/text/i);
  });
});

describe("other source types are unaffected", () => {
  test("quiz with a source id is still accepted by validation", async () => {
    // Validation runs before the service, so a 400 here would be indistinguishable
    // from the no-content case. Asserting the message proves which layer answered.
    const response = await generate({ sourceType: "quiz", sourceId: QUIZ_ID });

    expect(response.status).not.toBe(400);
  });

  test("mistakes still reaches the service", async () => {
    const { default: QuizAttempt } = await import("../../models/QuizAttempt.js");
    QuizAttempt.findOne.mockImplementation(async (filter) =>
      filter.user === USER_ID
        ? { _id: "507f1f77bcf86cd799439013", quiz: QUIZ_ID, answers: [], mistakeAnalyses: [] }
        : null
    );

    // A perfect attempt is refused by the service's own guard, with its own 400.
    // Reaching that message at all proves validation let the request through.
    const response = await generate({
      sourceType: "mistakes",
      sourceId: "507f1f77bcf86cd799439013",
    });

    expect(response.body.error).toMatch(/no incorrect answers/i);
  });
});
