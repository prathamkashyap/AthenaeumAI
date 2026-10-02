/**
 * Contract Tests — the application-level background job boundary
 *
 * BullMQ is a transport, not the public API. These tests pin the application
 * contract that sits above it: what states a job can be in, which transitions are
 * legal, that a terminal state is never overwritten, and that a job is never
 * reported as queued when the queue refused it.
 *
 * Only the model layer is replaced, so the state machine under test is the
 * production one.
 */

import { jest } from "@jest/globals";
import { QueueEnqueueError } from "../../utils/errors.js";

const backgroundJobCreate = jest.fn();
const backgroundJobFindOneAndUpdate = jest.fn();
// A Mongoose query is chainable, so the double exposes the same shape.
const backgroundJobFindOne = jest.fn();

jest.unstable_mockModule("../../models/BackgroundJob.js", () => ({
  default: {
    create: backgroundJobCreate,
    findOneAndUpdate: backgroundJobFindOneAndUpdate,
    findOne: backgroundJobFindOne,
  },
  BACKGROUND_JOB_STATUS: ["pending", "queued", "running", "completed", "failed", "not_scheduled"],
  TERMINAL_BACKGROUND_JOB_STATUS: ["completed", "failed", "not_scheduled"],
}));

const {
  createBackgroundJob,
  markJobQueued,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobNotScheduled,
  getBackgroundJobForUser,
  toPublicJob,
} = await import("../../services/backgroundJobService.js");

const { enqueueTrackedJob } = await import("../../utils/jobQueue.js");

const USER = "user-1";
const OTHER_USER = "user-2";

/** Builds a stored job document. */
const jobDoc = (overrides = {}) => ({
  _id: "job-1",
  user: USER,
  type: "INDEX_MATERIAL",
  status: "pending",
  resource: { materialId: "material-1", quizId: null, attemptId: null },
  queueJobId: null,
  error: { code: null, message: null },
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2026-05-01T09:00:00.000Z"),
  ...overrides,
});

/** Filters matching an open job, as the production conditional update requires. */
const isOpenJob = (filter) => ["pending", "queued", "running"].includes(filter.status?.$in?.[0]);

beforeEach(() => {
  jest.clearAllMocks();
  backgroundJobCreate.mockImplementation(async (doc) => ({ _id: "job-1", ...doc }));
  backgroundJobFindOneAndUpdate.mockImplementation(async (filter, update) => (
    isOpenJob(filter) ? jobDoc({ ...update.$set, _id: "job-1" }) : null
  ));
  backgroundJobFindOne.mockImplementation(() => ({
    lean: async () => jobDoc(),
  }));
});

// ─── State machine ────────────────────────────────────────────────────────────

describe("background job transitions", () => {
  test("a new job starts pending, before the queue has been asked", async () => {
    const job = await createBackgroundJob({ user: USER, type: "INDEX_MATERIAL", resource: { materialId: "m1" } });

    expect(job.status).toBe("pending");
    expect(backgroundJobCreate).toHaveBeenCalledWith({
      user: USER,
      type: "INDEX_MATERIAL",
      resource: { materialId: "m1" },
      status: "pending",
    });
  });

  test("queued records the queue's own job id for operators", async () => {
    await markJobQueued("job-1", "bull-77");

    const [, update] = backgroundJobFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({ status: "queued", queueJobId: "bull-77" });
  });

  test("running records a start time", async () => {
    await markJobRunning("job-1");

    const [, update] = backgroundJobFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe("running");
    expect(update.$set.startedAt).toBeInstanceOf(Date);
  });

  test("completed records a terminal time and clears any error", async () => {
    await markJobCompleted("job-1");

    const [, update] = backgroundJobFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({ status: "completed", error: { code: null, message: null } });
    expect(update.$set.completedAt).toBeInstanceOf(Date);
  });

  test("failed records only the safe code and message it was given", async () => {
    await markJobFailed("job-1", { code: "JOB_FAILED", message: "Background work did not complete." });

    const [, update] = backgroundJobFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe("failed");
    expect(update.$set.error).toEqual({ code: "JOB_FAILED", message: "Background work did not complete." });
  });

  test("every terminal transition refuses to move an already terminal job", async () => {
    for (const transition of [markJobCompleted, markJobFailed, markJobNotScheduled]) {
      backgroundJobFindOneAndUpdate.mockClear();
      // No document matches, which is what a terminal job looks like to the
      // conditional update.
      backgroundJobFindOneAndUpdate.mockResolvedValue(null);

      const result = await transition("job-1");

      expect(result).toBeNull();
      const [filter] = backgroundJobFindOneAndUpdate.mock.calls[0];
      expect(filter.status.$in).toEqual(["pending", "queued", "running"]);
    }
  });

  test("a late running event cannot resurrect a completed job", async () => {
    backgroundJobFindOneAndUpdate.mockResolvedValue(null);

    const result = await markJobRunning("job-1");

    expect(result).toBeNull();
  });
});

// ─── Enqueue ordering ─────────────────────────────────────────────────────────

describe("enqueueTrackedJob ordering", () => {
  const queueDouble = (impl) => ({ enqueue: jest.fn(impl) });

  test("records the job, then queues it", async () => {
    const order = [];
    backgroundJobCreate.mockImplementation(async (doc) => {
      order.push("create");
      return { _id: "job-1", ...doc };
    });
    const queue = queueDouble(async () => {
      order.push("enqueue");
      return { id: "bull-1" };
    });

    const result = await enqueueTrackedJob({
      user: USER, type: "INDEX_MATERIAL", data: { materialId: "m1" },
      resource: { materialId: "m1" }, deduplicationId: "index-material:m1",
      name: "INDEX_MATERIAL", createJobQueue: queue,
    });

    expect(order).toEqual(["create", "enqueue"]);
    expect(result.scheduled).toBe(true);
    expect(result.job._id).toBe("job-1");
  });

  test("passes the application job id to the worker without changing the data shape", async () => {
    const queue = queueDouble(async () => ({ id: "bull-1" }));

    await enqueueTrackedJob({
      user: USER, type: "SYNC_ATTEMPT",
      data: { attemptId: "a1", userId: USER, quizId: "q1" },
      resource: { attemptId: "a1" },
      deduplicationId: "sync-attempt:a1",
      name: "SYNC_ATTEMPT", createJobQueue: queue,
    });

    const [, payload, options] = queue.enqueue.mock.calls[0];
    expect(payload).toEqual({ type: "SYNC_ATTEMPT", data: { attemptId: "a1", userId: USER, quizId: "q1" }, jobId: "job-1" });
    expect(options).toEqual({ deduplicationId: "sync-attempt:a1" });
  });

  test("a refusal is recorded as not_scheduled, never as queued", async () => {
    const queue = queueDouble(async () => {
      throw new QueueEnqueueError("Background processing could not be scheduled.");
    });

    const result = await enqueueTrackedJob({
      user: USER, type: "INDEX_MATERIAL", data: {}, name: "INDEX_MATERIAL", createJobQueue: queue,
    });

    expect(result.scheduled).toBe(false);
    expect(result.error).toBeInstanceOf(QueueEnqueueError);

    const [, update] = backgroundJobFindOneAndUpdate.mock.calls.at(-1);
    expect(update.$set.status).toBe("not_scheduled");
    expect(update.$set.completedAt).toBeInstanceOf(Date);
  });

  test("a non-queue error propagates instead of being recorded as unscheduled", async () => {
    // Only a queue refusal means "committed but unscheduled". A bug must surface
    // as a failure of the request, not be laundered into a scheduling status.
    const queue = queueDouble(async () => { throw new TypeError("bug in the enqueue call site"); });

    await expect(enqueueTrackedJob({
      user: USER, type: "INDEX_MATERIAL", data: {}, name: "X", createJobQueue: queue,
    })).rejects.toThrow("bug in the enqueue call site");

    // Nothing was recorded, so no job is left claiming to be unscheduled either.
    expect(backgroundJobFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a refusal never reports the job as queued", async () => {
    const queue = queueDouble(async () => { throw new QueueEnqueueError("nope"); });

    await enqueueTrackedJob({ user: USER, type: "INDEX_MATERIAL", data: {}, name: "X", createJobQueue: queue });

    const statuses = backgroundJobFindOneAndUpdate.mock.calls.map(([, u]) => u.$set.status);
    expect(statuses).not.toContain("queued");
    expect(statuses).toEqual(["not_scheduled"]);
  });
});

// ─── Ownership and the public projection ──────────────────────────────────────

describe("job ownership and public shape", () => {
  test("a lookup is scoped by both id and owner", async () => {
    await getBackgroundJobForUser("job-1", USER);

    expect(backgroundJobFindOne).toHaveBeenCalledWith({ _id: "job-1", user: USER });
  });

  test("another learner's job is not retrievable by id alone", async () => {
    backgroundJobFindOne.mockImplementation(() => ({ lean: async () => null }));

    const result = await getBackgroundJobForUser("job-1", OTHER_USER);

    // The filter carries the owner, so the lookup cannot match somebody else's job.
    expect(result).toBeNull();
    expect(backgroundJobFindOne.mock.calls[0][0].user).toBe(OTHER_USER);
  });

  test("the public projection omits the queue's own job id", () => {
    const publicJob = toPublicJob(jobDoc({ queueJobId: "bull-77", status: "completed" }));

    expect(publicJob).not.toHaveProperty("queueJobId");
    expect(publicJob.jobId).toBe("job-1");
    expect(publicJob.status).toBe("completed");
    expect(publicJob.resource).toEqual({ materialId: "material-1", quizId: null, attemptId: null });
  });

  test("the public projection exposes a safe error only for failed jobs", () => {
    const failed = toPublicJob(jobDoc({
      status: "failed",
      error: { code: "JOB_FAILED", message: "Background work did not complete." },
    }));
    const running = toPublicJob(jobDoc({ status: "running" }));

    expect(failed.error).toEqual({ code: "JOB_FAILED", message: "Background work did not complete." });
    expect(running.error).toBeNull();
  });

  test("the public projection reports not_scheduled as an error-bearing state", () => {
    const unscheduled = toPublicJob(jobDoc({
      status: "not_scheduled",
      error: { code: "QUEUE_ENQUEUE_FAILED", message: "Background work could not be scheduled." },
    }));

    expect(unscheduled.status).toBe("not_scheduled");
    expect(unscheduled.error.code).toBe("QUEUE_ENQUEUE_FAILED");
  });
});
