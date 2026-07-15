import { QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";
import mongoose from "mongoose";
import User from "../../models/User.js";
import StudyMaterial from "../../models/StudyMaterial.js";
import MaterialChunk from "../../models/MaterialChunk.js";
import {
  BACKGROUND_QUEUE_NAME,
  backgroundQueue,
  jobQueue,
} from "../../utils/jobQueue.js";
import { processBackgroundJob } from "../../worker.js";

const queueTestsEnabled = process.env.ENABLE_JOB_QUEUE === "true";
const describeQueue = queueTestsEnabled ? describe : describe.skip;

const redisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
};

const testDbUri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;

const waitForCompletion = (job, queueEvents) => job.waitUntilFinished(queueEvents, 15000);

describeQueue("BullMQ background pipeline", () => {
  let worker;
  let queueEvents;
  let workerConnection;
  let eventsConnection;
  let user;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(testDbUri);
    }

    workerConnection = new Redis(redisOptions);
    eventsConnection = new Redis(redisOptions);
    worker = new Worker(BACKGROUND_QUEUE_NAME, processBackgroundJob, {
      connection: workerConnection,
      concurrency: 1,
    });
    queueEvents = new QueueEvents(BACKGROUND_QUEUE_NAME, { connection: eventsConnection });

    await Promise.all([worker.waitUntilReady(), queueEvents.waitUntilReady()]);
  }, 30000);

  beforeEach(async () => {
    await backgroundQueue.obliterate({ force: true });
    await Promise.all([
      MaterialChunk.deleteMany({}),
      StudyMaterial.deleteMany({}),
      User.deleteMany({ email: /bullmq-integration/ }),
    ]);

    user = await User.create({
      name: "BullMQ Integration",
      email: `bullmq-integration-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      passwordHash: "test-hash",
    });
  });

  afterAll(async () => {
    await Promise.all([
      worker?.close(),
      queueEvents?.close(),
      backgroundQueue?.close(),
      workerConnection?.quit(),
      eventsConnection?.quit(),
    ]);
    await mongoose.connection.close();
  }, 30000);

  test("enqueues and indexes a study material through the real worker", async () => {
    const material = await StudyMaterial.create({
      user: user._id,
      title: "BullMQ indexing probe",
      originalFileName: "probe.pdf",
      storagePath: "/tmp/probe.pdf",
      extractedText: "Database transactions preserve atomic learning updates. ".repeat(12),
      textPreview: "Database transactions preserve atomic learning updates.",
    });

    const job = await jobQueue.enqueue("RAG Index Material: BullMQ indexing probe", {
      type: "INDEX_MATERIAL",
      data: { materialId: material._id },
    }, {
      deduplicationId: `index-material:${material._id}`,
    });

    await expect(waitForCompletion(job, queueEvents)).resolves.toMatchObject({
      type: "INDEX_MATERIAL",
      materialId: String(material._id),
    });

    const chunks = await MaterialChunk.find({ studyMaterial: material._id }).lean();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].embedding).toHaveLength(384);
    expect(chunks[0].metadata.indexedAt).toBeDefined();

    const completed = await backgroundQueue.getCompleted(0, 10);
    expect(completed.some((completedJob) => completedJob.id === job.id)).toBe(true);
  });

  test("deduplicates concurrent rebuild jobs for the same learner", async () => {
    await backgroundQueue.pause();
    try {
      const payload = {
        type: "REBUILD_REVIEW_QUEUE",
        data: { userId: user._id },
      };
      const deduplicationId = `rebuild-review-queue:${user._id}`;
      const first = await jobQueue.enqueue("Rebuild Review Queue", payload, { deduplicationId });
      const duplicate = await jobQueue.enqueue("Rebuild Review Queue", payload, { deduplicationId });

      expect(duplicate.id).toBe(first.id);
      await backgroundQueue.resume();
      await expect(waitForCompletion(first, queueEvents)).resolves.toMatchObject({
        type: "REBUILD_REVIEW_QUEUE",
      });
    } finally {
      await backgroundQueue.resume();
    }
  });

  test("retries malformed jobs and retains their failed record", async () => {
    const job = await jobQueue.enqueue("Invalid background job", {
      type: "UNKNOWN_JOB_TYPE",
      data: {},
    }, {
      attempts: 2,
      backoff: { type: "fixed", delay: 25 },
    });

    await expect(waitForCompletion(job, queueEvents)).rejects.toThrow("Unknown background job type");

    const failedJob = await backgroundQueue.getJob(job.id);
    expect(failedJob.attemptsMade).toBe(2);
    expect(failedJob.failedReason).toContain("Unknown background job type");

    const failed = await backgroundQueue.getFailed(0, 10);
    expect(failed.some((failedQueueJob) => failedQueueJob.id === job.id)).toBe(true);
  });
});
