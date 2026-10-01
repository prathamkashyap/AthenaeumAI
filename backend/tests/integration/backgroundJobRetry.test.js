/**
 * Retry contract, driven end to end.
 *
 * The unit suite proves the controller's decisions with the queue replaced. This
 * file proves the part that only a real boundary can show: an HTTP retry against
 * the real router reaches a real BullMQ queue, is picked up by a real worker, runs
 * the real `SYNC_ATTEMPT` transaction against a real replica set, and leaves the
 * learner's persisted state applied exactly once.
 *
 * The retry reuses the job's own record, so the assertions here also cover the
 * claim that no second tracking row appears.
 */
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { config } from "dotenv";
import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import backgroundJobRoutes from "../../routes/backgroundJobRoutes.js";
import { runJobWithStatusTracking } from "../../worker.js";
import { BACKGROUND_QUEUE_NAME } from "../../utils/jobQueue.js";
import { createToken } from "../../utils/auth.js";
import {
  TRANSACTION_SUPPORT,
  classifyTransactionSupport,
} from "../../config/database.js";
import User from "../../models/User.js";
import Quiz from "../../models/Quiz.js";
import QuizAttempt from "../../models/QuizAttempt.js";
import UserProgress from "../../models/UserProgress.js";
import LearningEvent from "../../models/LearningEvent.js";
import Notification from "../../models/Notification.js";
import ReviewQueue from "../../models/ReviewQueue.js";
import BackgroundJob from "../../models/BackgroundJob.js";
import connectDB from "../../config/database.js";

config({ path: new URL("../../.env", import.meta.url).pathname });

const queueTestsEnabled = process.env.ENABLE_JOB_QUEUE === "true";

const testDbUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/athenaeumAI_test";

let connected = false;
let deployment = null;

try {
  // The real bootstrap is used rather than a bare mongoose.connect, because the
  // router under test sits behind requireAuth, which gates on the connection flag
  // that only connectDB sets. It also probes transaction support, which the work
  // under test genuinely requires.
  if (mongoose.connection.readyState === 0) {
    process.env.MONGODB_URI = testDbUri;
    await connectDB();
  }
  connected = true;
  deployment = await mongoose.connection.getClient().db("admin").command({ hello: 1 });
} catch (error) {
  console.warn(`[backgroundJobRetry] MongoDB unavailable, skipping: ${error.message}`);
}

const transactionsAvailable =
  deployment !== null &&
  classifyTransactionSupport(deployment) === TRANSACTION_SUPPORT.SUPPORTED;

// The work under test is a MongoDB transaction, so a standalone deployment is
// reported as incapable rather than allowed to pass as though it had run.
if (connected && !transactionsAvailable) {
  console.warn(
    "[backgroundJobRetry] Connected deployment is not transaction-capable, " +
      "skipping the retry integration test.",
  );
}

const describeRetry = queueTestsEnabled && transactionsAvailable ? describe : describe.skip;

const redisConnection = () =>
  new IORedis({
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  });

let worker;
let queueEvents;
let connection;
let app;

const settle = async (predicate, { timeout = 15000, interval = 150 } = {}) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Timed out waiting for the expected state.");
};

describeRetry("POST /api/v1/jobs/:id/retry against a real queue and worker", () => {
  const created = { users: [], quizzes: [], attempts: [], jobs: [] };
  let token;

  const cleanup = async () => {
    await Promise.all([
      LearningEvent.deleteMany({ user: { $in: created.users } }),
      UserProgress.deleteMany({ user: { $in: created.users } }),
      ReviewQueue.deleteMany({ user: { $in: created.users } }),
      Notification.deleteMany({ user: { $in: created.users } }),
      QuizAttempt.deleteMany({ _id: { $in: created.attempts } }),
      Quiz.deleteMany({ _id: { $in: created.quizzes } }),
      BackgroundJob.deleteMany({ _id: { $in: created.jobs } }),
      User.deleteMany({ _id: { $in: created.users } }),
    ]);
    created.users = [];
    created.quizzes = [];
    created.attempts = [];
    created.jobs = [];
  };

  /**
   * A learner, a quiz, an attempt in the requested sync state, and the terminal
   * job that is supposed to be recoverable.
   */
  const seed = async ({ status, synced }) => {
    const user = await User.create({
      name: "Retry Learner",
      email: `retry-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
      passwordHash: "not-a-real-hash",
    });
    created.users.push(user._id);

    const quiz = await Quiz.create({
      title: "Retry quiz",
      subject: "Mathematics",
      difficulty: "Medium",
      questions: [
        { question: "1+1?", options: ["1", "2", "3", "4"], answer: 1, topic: "Algebra" },
        { question: "2+2?", options: ["3", "4", "5", "6"], answer: 1, topic: "Algebra" },
      ],
    });
    created.quizzes.push(quiz._id);

    const attempt = await QuizAttempt.create({
      user: user._id,
      quiz: quiz._id,
      score: 1,
      total: 2,
      accuracy: 50,
      difficulty: "Medium",
      answers: [
        { questionIndex: 0, selected: 1, correct: 1, isCorrect: true, topic: "Algebra" },
        { questionIndex: 1, selected: 0, correct: 1, isCorrect: false, topic: "Algebra" },
      ],
      mistakeAnalyses: [
        { questionIndex: 1, topic: "Algebra", misconception: "off by one", clarification: "2+2=4" },
      ],
      ...(synced ? { sync: { status: "processed", appliedAt: new Date() } } : { sync: { status: "pending" } }),
    });
    created.attempts.push(attempt._id);

    const job = await BackgroundJob.create({
      user: user._id,
      type: "SYNC_ATTEMPT",
      status,
      resource: { materialId: null, quizId: quiz._id, attemptId: attempt._id },
      ...(status === "not_scheduled"
        ? { error: { code: "QUEUE_ENQUEUE_FAILED", message: "Background work could not be scheduled." } }
        : { error: { code: "JOB_FAILED", message: "Background work did not complete." } }),
      completedAt: new Date(),
    });
    created.jobs.push(job._id);

    return { user, quiz, attempt, job };
  };

  beforeAll(async () => {
    // A transaction cannot create collections implicitly, so an empty database
    // would fail for reasons unrelated to the contract under test.
    await Promise.all([
      User.init(),
      Quiz.init(),
      QuizAttempt.init(),
      UserProgress.init(),
      LearningEvent.init(),
      Notification.init(),
      ReviewQueue.init(),
      BackgroundJob.init(),
    ]);

    connection = redisConnection();
    // The real dispatch wrapper, which is what marks the tracked record running
    // and completed. The bare processor would apply effects without ever settling
    // the job status this contract is about.
    worker = new Worker(BACKGROUND_QUEUE_NAME, runJobWithStatusTracking, { connection });
    queueEvents = new QueueEvents(BACKGROUND_QUEUE_NAME, { connection });

    // The real router, including its real authentication middleware.
    app = express();
    app.use(express.json());
    app.use("/api/v1/jobs", backgroundJobRoutes);
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    token = null;
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    if (queueEvents) await queueEvents.close();
    if (worker) await worker.close();
    if (connection) await connection.quit();
    if (connected) await mongoose.connection.close();
  }, 30000);

  // 15 + 20
  test("a not_scheduled job retries and applies a still-pending attempt exactly once", async () => {
    const { user, attempt, job } = await seed({ status: "not_scheduled", synced: false });
    token = createToken(user);

    const response = await request(app)
      .post(`/api/v1/jobs/${job._id}/retry`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attemptId: "ignored", userId: "ignored" });

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBe(String(job._id));
    // With a live worker the record can already have advanced past `queued` by
    // the time the response is read, so the contract asserted here is that it has
    // left its terminal state at all. That it reads exactly `queued` is pinned
    // deterministically by the unit suite.
    expect(["queued", "running", "completed"]).toContain(response.body.status);

    await settle(async () => (await BackgroundJob.findById(job._id)).status === "completed");

    const applied = await QuizAttempt.findById(attempt._id).lean();
    expect(applied.sync.status).toBe("processed");

    const progress = await UserProgress.findOne({ user: user._id }).lean();
    expect(progress.totals.quizzesTaken).toBe(1);
    expect(await LearningEvent.countDocuments({ user: user._id, eventType: "quiz_attempt" })).toBe(2);

    // The retry reused this record rather than creating a second one.
    // Dot notation, because a nested object filter would be an exact-subdocument
    // match rather than a field match.
    expect(
      await BackgroundJob.countDocuments({ "resource.attemptId": attempt._id }),
    ).toBe(1);
  }, 40000);

  // 16
  test("a failed job retries and applies a still-pending attempt exactly once", async () => {
    const { user, attempt, job } = await seed({ status: "failed", synced: false });
    token = createToken(user);

    const response = await request(app)
      .post(`/api/v1/jobs/${job._id}/retry`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);

    await settle(async () => (await BackgroundJob.findById(job._id)).status === "completed");

    expect((await QuizAttempt.findById(attempt._id).lean()).sync.status).toBe("processed");
    const progress = await UserProgress.findOne({ user: user._id }).lean();
    expect(progress.totals.quizzesTaken).toBe(1);
  }, 40000);

  // 17 + 18
  test("retrying an already-processed attempt reapplies no transactional effect", async () => {
    const { user, attempt, job } = await seed({ status: "failed", synced: true });
    token = createToken(user);

    const response = await request(app)
      .post(`/api/v1/jobs/${job._id}/retry`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);

    await settle(async () => (await BackgroundJob.findById(job._id)).status === "completed");

    // Nothing was committed for this attempt, so the retry must add nothing.
    expect(await UserProgress.countDocuments({ user: user._id })).toBe(0);
    expect(await LearningEvent.countDocuments({ user: user._id })).toBe(0);
    expect((await QuizAttempt.findById(attempt._id).lean()).sync.status).toBe("processed");
  }, 40000);

  // 19
  test("two concurrent retries through the API produce one delivery", async () => {
    const { user, job } = await seed({ status: "not_scheduled", synced: false });
    token = createToken(user);

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/jobs/${job._id}/retry`).set("Authorization", `Bearer ${token}`).send({}),
      request(app).post(`/api/v1/jobs/${job._id}/retry`).set("Authorization", `Bearer ${token}`).send({}),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    await settle(async () => (await BackgroundJob.findById(job._id)).status === "completed");

    const progress = await UserProgress.findOne({ user: user._id }).lean();
    expect(progress.totals.quizzesTaken).toBe(1);
    expect(await LearningEvent.countDocuments({ user: user._id, eventType: "quiz_attempt" })).toBe(2);
  }, 40000);

  // 20 + ownership over HTTP
  test("another learner cannot retry the job over HTTP", async () => {
    const { job } = await seed({ status: "not_scheduled", synced: false });

    const intruder = await User.create({
      name: "Intruder",
      email: `intruder-${Date.now()}@example.test`,
      passwordHash: "not-a-real-hash",
    });
    created.users.push(intruder._id);

    const response = await request(app)
      .post(`/api/v1/jobs/${job._id}/retry`)
      .set("Authorization", `Bearer ${createToken(intruder)}`)
      .send({});

    expect(response.status).toBe(404);
    expect((await BackgroundJob.findById(job._id).lean()).status).toBe("not_scheduled");
  }, 30000);
});