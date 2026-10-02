/**
 * Integration Tests — the tutor's grounding refusal reaches the learner
 * =============================================================
 *
 * `tests/unit/tutorGroundingRefusal.test.js` asserts the schema and drives the
 * recorder's failure mode, but it mocks the persistence boundary — which is
 * exactly the seam that hid this defect. `tutorService.test.js` mocked the
 * recorder entirely, so the `result` value it asserted on never met a schema.
 *
 * This file closes that gap against a real database. The only things replaced
 * here are the retrieval and learner-profile reads that would otherwise need
 * indexed material and a real user history. The learning-event recorder, the
 * `LearningEvent` model and the tutor service are all the real ones, so the
 * scenario is the one a learner actually triggers: ask about something the
 * library does not cover.
 *
 * The property is that a refusal is a correct outcome. It must be returned to the
 * client, and it must be recorded, rather than surfacing as a database error.
 *
 * These need MongoDB but not Redis, so — like `attemptSyncDurability.test.js` —
 * they are not gated behind the job queue being enabled.
 */

import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { config } from "dotenv";
import LearningEvent from "../../models/LearningEvent.js";

config({ path: new URL("../../.env", import.meta.url).pathname });

const testDbUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/athenaeumAI_test";

const chainableLeanQuery = (result) => {
  const query = {
    lean: () => query,
    sort: () => query,
    limit: () => query,
    select: () => query,
    populate: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

// No indexed evidence: the production grounding gate refuses on an absent result
// set, before the model is consulted.
jest.unstable_mockModule("../../models/MaterialChunk.js", () => ({
  default: {
    find: jest.fn(() => chainableLeanQuery([])),
    countDocuments: jest.fn(async () => 0),
    bulkWrite: jest.fn(async () => undefined),
    deleteMany: jest.fn(async () => undefined),
  },
}));

jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: {
    find: jest.fn(() => ({ select: () => ({ then: (resolve) => Promise.resolve([]).then(resolve) }) })),
  },
}));

const USER_ID = new mongoose.Types.ObjectId();

jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOne: jest.fn(() => chainableLeanQuery(null)) },
}));
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({
  default: { find: jest.fn(() => chainableLeanQuery([])) },
}));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({
  default: { find: jest.fn(() => chainableLeanQuery([])) },
}));

let connected = false;

try {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDbUri, { serverSelectionTimeoutMS: 5000 });
  }
  LearningEvent.syncIndexes();
  connected = true;
} catch (error) {
  console.warn(`[tutorGroundingRefusalPersistence] MongoDB unavailable, skipping: ${error.message}`);
}

const { askContextualTutor } = await import("../../services/tutorService.js");

afterAll(async () => {
  if (connected) {
    await LearningEvent.deleteMany({ user: USER_ID });
    await mongoose.connection.close();
  }
}, 15000);

const describeDb = connected ? describe : describe.skip;

describeDb("a grounding refusal, end to end", () => {
  const QUESTION = "What are the necessary conditions for a deadlock?";

  beforeEach(async () => {
    await LearningEvent.deleteMany({ user: USER_ID });
  });

  afterAll(async () => {
    if (connected) await LearningEvent.deleteMany({ user: USER_ID });
  });

  const ask = () => askContextualTutor({ userId: USER_ID, question: QUESTION });

  // ─── The refusal is returned, not an error ─────────────────────────────────

  test("the request resolves instead of failing validation", async () => {
    await expect(ask()).resolves.toBeDefined();
  });

  test("it is reported as ungrounded rather than answered", async () => {
    const response = await ask();
    expect(response.grounding).toMatchObject({ grounded: false, reason: "no_context" });
  });

  test("it cites nothing", async () => {
    const response = await ask();
    expect(response.groundedSources).toEqual([]);
    expect(response.retrievedContext).toEqual([]);
  });

  test("it carries the fields the client renders", async () => {
    const response = await ask();
    for (const key of ["answer", "groundedSources", "personalizedNotes", "revisionPlan", "suggestedFollowUps"]) {
      expect(response).toHaveProperty(key);
    }
    expect(response.answer).toBeTruthy();
  });

  // ─── The refusal is recorded through the real model ────────────────────────

  test("a LearningEvent document is written for the refusal", async () => {
    await ask();

    const events = await LearningEvent.find({ user: USER_ID, eventType: "ai_tutoring_interaction" }).lean();
    expect(events).toHaveLength(1);
  });

  test("it is stored as insufficient_context, a value the schema accepts", async () => {
    await ask();

    const [event] = await LearningEvent.find({ user: USER_ID }).lean();
    // This is the assertion that failed as a validation error before the enum was
    // widened. Reading it back from Mongo proves the write survived the schema,
    // not merely that the code intended it.
    expect(event.result).toBe("insufficient_context");
  });

  test("it is stored as a refusal, not as a partial answer", async () => {
    await ask();

    const [event] = await LearningEvent.find({ user: USER_ID }).lean();
    expect(event.result).not.toBe("partial");
    expect(event.result).not.toBe("completed");
  });

  test("the stored event keeps the refusal's grounding metadata", async () => {
    await ask();

    const [event] = await LearningEvent.find({ user: USER_ID }).lean();
    expect(event.metadata.question).toBe(QUESTION);
    expect(event.metadata.grounding).toMatchObject({ grounded: false });
    expect(event.metadata.sourceCount).toBe(0);
  });

  // ─── Repeated refusals accumulate as separate, valid records ───────────────

  test("each refusal is recorded once", async () => {
    await ask();
    await ask();

    const events = await LearningEvent.find({ user: USER_ID }).lean();
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.result === "insufficient_context")).toBe(true);
  });
});
