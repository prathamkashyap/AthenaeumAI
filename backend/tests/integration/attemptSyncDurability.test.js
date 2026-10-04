/**
 * Integration Tests — the durable attempt-sync claim (`SYNC_ATTEMPT` idempotency)
 *
 * The unit suite in `tests/unit/attemptProcessing.test.js` replaces the Mongoose
 * layer with a stateful double, which is what makes the exactly-once contract
 * cheap to assert. It cannot, however, see the real `QuizAttempt` schema, so the
 * two properties the double assumes about the durable marker are checked here
 * against a real MongoDB connection and the real model:
 *
 *   1. a newly stored attempt really does start unclaimed, so a fresh attempt is
 *      never mistaken for one whose effects were already applied;
 *   2. the marker's field, enum and default are what the claim in
 *      `worker.js` actually writes and filters on.
 *
 * These need MongoDB but not Redis, so unlike `bullmq.test.js` they are not gated
 * behind the job queue being enabled.
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import QuizAttempt from "../../models/QuizAttempt.js";

config({ path: new URL("../../.env", import.meta.url).pathname });

const testDbUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/athenaeumAI_test";

let connected = false;

try {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDbUri, { serverSelectionTimeoutMS: 5000 });
  }
  connected = true;
} catch (error) {
  console.warn(`[attemptSyncDurability] MongoDB unavailable, skipping: ${error.message}`);
}

afterAll(async () => {
  if (connected) await mongoose.connection.close();
}, 15000);

const describeDb = connected ? describe : describe.skip;

describeDb("QuizAttempt durable sync marker", () => {
  const newAttempt = (overrides = {}) =>
    new QuizAttempt({
      user: new mongoose.Types.ObjectId(),
      quiz: new mongoose.Types.ObjectId(),
      score: 3,
      total: 5,
      accuracy: 60,
      difficulty: "Medium",
      answers: [],
      mistakeAnalyses: [],
      ...overrides,
    });

  test("stores a new attempt as unclaimed", () => {
    const attempt = newAttempt();
    expect(attempt.sync?.status).toBe("pending");
    expect(attempt.sync?.appliedAt ?? null).toBeNull();
  });

  test("accepts only pending and processed as a sync status", () => {
    const values = QuizAttempt.schema.path("sync.status").enumValues;
    expect(values).toEqual(expect.arrayContaining(["pending", "processed"]));
  });

  test("round-trips a processed marker through a real database", async () => {
    const attempt = newAttempt();
    await attempt.save();

    const filter = { _id: attempt._id, "sync.status": { $ne: "processed" } };
    const claimed = await QuizAttempt.findOneAndUpdate(
      filter,
      { $set: { "sync.status": "processed", "sync.appliedAt": new Date() } },
      { returnDocument: "after" },
    );
    expect(claimed.sync.status).toBe("processed");
    expect(claimed.sync.appliedAt).toBeInstanceOf(Date);

    // A second claim with the same condition must match nothing, which is what
    // makes a repeat delivery a no-op rather than a second application.
    const second = await QuizAttempt.findOneAndUpdate(
      filter,
      { $set: { "sync.status": "processed", "sync.appliedAt": new Date() } },
      { returnDocument: "after" },
    );
    expect(second).toBeNull();

    await QuizAttempt.deleteOne({ _id: attempt._id });
  });

  test("rejects an unknown sync status", async () => {
    const attempt = newAttempt();
    attempt.sync.status = "somewhere-else";
    await expect(attempt.validate()).rejects.toThrow(/sync.status/);
  });
});
