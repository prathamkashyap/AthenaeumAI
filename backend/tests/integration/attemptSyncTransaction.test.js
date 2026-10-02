/**
 * Task 37 — executes the durable SYNC_ATTEMPT transaction against a real
 * MongoDB transaction.
 *
 * The unit suite replaces runInTransaction with a fake session, and the
 * existing attemptSyncDurability test only round-trips the sync marker, so
 * before this file the repository's central claim-once-and-apply-or-nothing
 * invariant had never run against a real transaction.
 *
 * Nothing about the transaction helper, the Mongoose session, or the worker
 * function is mocked here. The only seam Scenario C breaks is the final
 * effect write, which is what makes the rollback assertion meaningful.
 */
import { jest } from "@jest/globals";
import { config } from "dotenv";
import mongoose from "mongoose";
import {
  TRANSACTION_SUPPORT,
  classifyTransactionSupport,
} from "../../config/database.js";
import * as realLearningEventService from "../../services/learningEventService.js";
import User from "../../models/User.js";
import Quiz from "../../models/Quiz.js";
import QuizAttempt from "../../models/QuizAttempt.js";
import UserProgress from "../../models/UserProgress.js";
import LearningEvent from "../../models/LearningEvent.js";
import Notification from "../../models/Notification.js";

/**
 * The single seam Scenario C is permitted to break.
 *
 * recordAttemptEvents runs last inside the production transaction, so failing
 * it aborts the transaction only after the durable claim and the learner
 * progress writes have already been issued. That is exactly the window the
 * atomicity guarantee covers, and it keeps runInTransaction real.
 */
let failEventWrite = false;
jest.unstable_mockModule("../../services/learningEventService.js", () => {
  const actual = realLearningEventService;
  return {
    ...actual,
    recordAttemptEvents: async (args) => {
      if (failEventWrite) {
        throw new Error("injected failure inside the attempt-sync transaction");
      }
      return actual.recordAttemptEvents(args);
    },
  };
});

const { syncAttemptOnce } = await import("../../worker.js");

config({ path: new URL("../../.env", import.meta.url).pathname });

const testDbUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/athenaeumAI_test";

let connected = false;
let deployment = null;

try {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDbUri, { serverSelectionTimeoutMS: 5000 });
  }
  connected = true;
  // What the connected server reports about itself, unmediated. A standalone
  // deployment has no setName and cannot host the transaction under test.
  deployment = await mongoose.connection.getClient().db("admin").command({ hello: 1 });
} catch (error) {
  console.warn(
    `[attemptSyncTransaction] MongoDB unavailable, skipping: ${error.message}`,
  );
}

const transactionsAvailable =
  deployment !== null &&
  classifyTransactionSupport(deployment) === TRANSACTION_SUPPORT.SUPPORTED;

if (connected && !transactionsAvailable) {
  console.warn(
    "[attemptSyncTransaction] Connected deployment is not transaction-capable, " +
      "skipping the real SYNC_ATTEMPT transaction test.",
  );
}

afterAll(async () => {
  if (connected) await mongoose.connection.close();
}, 15000);

const describeTx = transactionsAvailable ? describe : describe.skip;

const buildAttempt = async ({ prefix }) => {
  const user = await User.create({
    name: `${prefix} learner`,
    email: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
    passwordHash: "not-a-real-hash",
  });

  const quiz = await Quiz.create({
    title: `${prefix} quiz`,
    subject: "Mathematics",
    difficulty: "Medium",
    questions: [
      {
        question: "What is 1 + 1?",
        options: ["1", "2", "3", "4"],
        answer: 1,
        topic: "Algebra",
      },
      {
        question: "What is 2 + 2?",
        options: ["3", "4", "5", "6"],
        answer: 1,
        topic: "Algebra",
      },
    ],
  });

  const attempt = await QuizAttempt.create({
    user: user._id,
    quiz: quiz._id,
    score: 1,
    total: 2,
    accuracy: 50,
    difficulty: "Medium",
    durationSeconds: 42,
    answers: [
      { questionIndex: 0, selected: 1, correct: 1, isCorrect: true, topic: "Algebra" },
      { questionIndex: 1, selected: 0, correct: 1, isCorrect: false, topic: "Algebra" },
    ],
    sync: { status: "pending" },
  });

  return { user, quiz, attempt };
};

const readAttempt = (id) => QuizAttempt.findById(id).lean();
const eventsFor = (userId) => LearningEvent.countDocuments({ user: userId });

describeTx("SYNC_ATTEMPT applies its claim and effects atomically", () => {
  beforeAll(async () => {
    // A transaction cannot create collections or indexes implicitly. On a fresh
    // database the first write inside one fails with "catalog changes", which is
    // an artefact of an empty database rather than of the invariant under test.
    // Every deployed database already has these collections, so they are created
    // here instead of leaving the test dependent on insertion order.
    await Promise.all([
      User.init(),
      Quiz.init(),
      QuizAttempt.init(),
      UserProgress.init(),
      LearningEvent.init(),
      Notification.init(),
    ]);
  }, 60000);

  let user;
  let quiz;
  let attempt;

  beforeEach(async () => {
    ({ user, quiz, attempt } = await buildAttempt({ prefix: "tx-apply" }));
  }, 30000);

  afterEach(async () => {
    if (!user?._id || !attempt?._id || !quiz?._id) return;
    await Promise.all([
      LearningEvent.deleteMany({ user: user._id }),
      UserProgress.deleteMany({ user: user._id }),
      QuizAttempt.deleteMany({ _id: attempt._id }),
      Quiz.deleteMany({ _id: quiz._id }),
      User.deleteMany({ _id: user._id }),
    ]);
  });

  // Scenario A
  it("applies the durable claim and every learner effect on first delivery", async () => {
    const applied = await syncAttemptOnce({ attempt, quiz, userId: user._id });

    expect(applied).toBe(true);

    const persisted = await readAttempt(attempt._id);
    expect(persisted.sync.status).toBe("processed");
    expect(persisted.sync.appliedAt).toBeTruthy();

    const progress = await UserProgress.findOne({ user: user._id }).lean();
    expect(progress).not.toBeNull();
    expect(progress.totals.quizzesTaken).toBe(1);
    expect(progress.totals.questionsAnswered).toBe(2);
    expect(progress.totals.correctAnswers).toBe(1);

    expect(await eventsFor(user._id)).toBe(2);
  }, 30000);

  // Scenario B
  it("applies nothing on duplicate delivery of an already processed attempt", async () => {
    await syncAttemptOnce({ attempt, quiz, userId: user._id });

    const progressAfterFirst = await UserProgress.findOne({ user: user._id }).lean();
    const eventsAfterFirst = await eventsFor(user._id);
    const attemptAfterFirst = await readAttempt(attempt._id);

    const reapplied = await syncAttemptOnce({ attempt, quiz, userId: user._id });

    // The persisted state is compared first, because a return value of false
    // alone would not show whether a second delivery actually re-applied
    // anything.
    const progressAfterSecond = await UserProgress.findOne({ user: user._id }).lean();
    expect(await eventsFor(user._id)).toBe(eventsAfterFirst);
    expect(progressAfterSecond.totals.quizzesTaken).toBe(
      progressAfterFirst.totals.quizzesTaken,
    );
    expect(progressAfterSecond.totals.questionsAnswered).toBe(
      progressAfterFirst.totals.questionsAnswered,
    );
    expect(progressAfterSecond.totals.correctAnswers).toBe(
      progressAfterFirst.totals.correctAnswers,
    );

    expect(reapplied).toBe(false);

    const attemptAfterSecond = await readAttempt(attempt._id);
    expect(attemptAfterSecond.sync.status).toBe("processed");
    expect(attemptAfterSecond.sync.appliedAt).toEqual(attemptAfterFirst.sync.appliedAt);
  }, 30000);

  // Scenario C
  it("rolls back the claim and every effect when an effect fails mid-transaction", async () => {
    failEventWrite = true;

    await expect(
      syncAttemptOnce({ attempt, quiz, userId: user._id }),
    ).rejects.toThrow("injected failure inside the attempt-sync transaction");

    // The claim was written inside the transaction, so it must have rolled back.
    const persisted = await readAttempt(attempt._id);
    expect(persisted.sync.status).not.toBe("processed");
    expect(persisted.sync.status).toBe("pending");
    expect(persisted.sync.appliedAt).toBeFalsy();

    // The progress write happened before the injected failure, so its absence
    // is what proves the rollback rather than merely the ordering.
    expect(await UserProgress.countDocuments({ user: user._id })).toBe(0);
    expect(await eventsFor(user._id)).toBe(0);
  }, 30000);
});