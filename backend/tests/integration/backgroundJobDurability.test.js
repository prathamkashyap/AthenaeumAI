/**
 * Integration Tests — the background job record against real MongoDB
 *
 * The unit suites replace the model layer, so they cannot see whether the
 * conditional updates behave the same way against a real database, nor whether
 * the retention index and the enum are actually honoured. This suite exercises
 * the production model and service against the test database.
 *
 * It needs MongoDB but not Redis: no job is actually scheduled here.
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import BackgroundJob, { BACKGROUND_JOB_STATUS } from "../../models/BackgroundJob.js";
import {
  createBackgroundJob,
  markJobQueued,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobNotScheduled,
  getBackgroundJobForUser,
  toPublicJob,
} from "../../services/backgroundJobService.js";

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
  console.warn(`[backgroundJobDurability] MongoDB unavailable, skipping: ${error.message}`);
}

const describeDb = connected ? describe : describe.skip;

const USER = new mongoose.Types.ObjectId();
const OTHER_USER = new mongoose.Types.ObjectId();

beforeEach(async () => {
  if (connected) await BackgroundJob.deleteMany({});
});

afterAll(async () => {
  if (connected) await mongoose.connection.close();
});

describeDb("background job persistence", () => {
  test("a new job is stored as pending", async () => {
    const job = await createBackgroundJob({
      user: USER,
      type: "INDEX_MATERIAL",
      resource: { materialId: new mongoose.Types.ObjectId() },
    });

    const stored = await BackgroundJob.findById(job._id).lean();
    expect(stored.status).toBe("pending");
    expect(stored.startedAt).toBeNull();
    expect(stored.completedAt).toBeNull();
    expect(String(stored.user)).toBe(String(USER));
  });

  test("the full lifecycle is persisted in order", async () => {
    const job = await createBackgroundJob({ user: USER, type: "SYNC_ATTEMPT" });

    await markJobQueued(job._id, "bull-1");
    await markJobRunning(job._id);
    await markJobCompleted(job._id);

    const stored = await BackgroundJob.findById(job._id).lean();
    expect(stored.status).toBe("completed");
    expect(stored.queueJobId).toBe("bull-1");
    expect(stored.startedAt).toBeInstanceOf(Date);
    expect(stored.completedAt).toBeInstanceOf(Date);
    expect(stored.error).toEqual({ code: null, message: null });
  });

  test("a terminal state is never overwritten by a real database update", async () => {
    const job = await createBackgroundJob({ user: USER, type: "INDEX_MATERIAL" });

    await markJobCompleted(job._id);
    // A duplicated or late delivery tries to move it back to running and to fail it.
    expect(await markJobRunning(job._id)).toBeNull();
    expect(await markJobFailed(job._id)).toBeNull();

    const stored = await BackgroundJob.findById(job._id).lean();
    expect(stored.status).toBe("completed");
  });

  test("an unscheduled job is terminal and keeps its reason", async () => {
    const job = await createBackgroundJob({ user: USER, type: "INDEX_MATERIAL" });

    await markJobNotScheduled(job._id);

    const stored = await BackgroundJob.findById(job._id).lean();
    expect(stored.status).toBe("not_scheduled");
    expect(stored.error.code).toBe("QUEUE_ENQUEUE_FAILED");
    expect(await markJobRunning(job._id)).toBeNull();
  });

  test("one learner cannot read another learner's job", async () => {
    const job = await createBackgroundJob({ user: USER, type: "INDEX_MATERIAL" });

    const owned = await getBackgroundJobForUser(job._id, USER);
    const foreign = await getBackgroundJobForUser(job._id, OTHER_USER);

    expect(owned?._id).toBeTruthy();
    expect(foreign).toBeNull();
  });

  test("an unknown job id reads as null", async () => {
    const missing = new mongoose.Types.ObjectId();
    expect(await getBackgroundJobForUser(missing, USER)).toBeNull();
  });

  test("the schema rejects a status outside the public vocabulary", async () => {
    const job = new BackgroundJob({ user: USER, type: "INDEX_MATERIAL", status: "half-done" });

    await expect(job.validate()).rejects.toThrow(/status/);
  });

  test("the schema rejects a job type outside the public vocabulary", async () => {
    const job = new BackgroundJob({ user: USER, type: "SOMETHING_ELSE" });

    await expect(job.validate()).rejects.toThrow(/type/);
  });

  test("the public vocabulary is exactly the documented states", () => {
    expect([...BACKGROUND_JOB_STATUS].sort()).toEqual([
      "completed", "failed", "not_scheduled", "pending", "queued", "running",
    ]);
  });

  test("retention is keyed on completion, so unfinished jobs are never auto-removed", () => {
    const indexes = BackgroundJob.schema.indexes();
    const ttl = indexes.find(([, options]) => options?.expireAfterSeconds !== undefined);

    expect(ttl).toBeDefined();
    expect(ttl[0].completedAt).toBe(1);
    // 30 days, matching the documented policy.
    expect(ttl[1].expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });

  test("the public projection hides the queue job id but keeps the resource", async () => {
    const materialId = new mongoose.Types.ObjectId();
    const job = await createBackgroundJob({
      user: USER, type: "INDEX_MATERIAL", resource: { materialId },
    });
    await markJobQueued(job._id, "bull-secret");

    const stored = await BackgroundJob.findById(job._id).lean();
    const publicJob = toPublicJob(stored);

    expect(publicJob.resource.materialId).toBe(String(materialId));
    expect(JSON.stringify(publicJob)).not.toMatch(/bull-secret/);
  });
});
