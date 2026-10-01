/**
 * Contract Tests — the job status endpoint
 *
 * Drives the real `backgroundJobController` and the real `backgroundJobService`
 * lookup, with only the model replaced. The point of this suite is the tenancy
 * rule: a job identifier must never be sufficient to read another learner's job.
 */

import { jest } from "@jest/globals";

const backgroundJobFindOne = jest.fn();
const backgroundJobFindOneAndUpdate = jest.fn();
const queueEnqueue = jest.fn();

jest.unstable_mockModule("../../models/BackgroundJob.js", () => ({
  default: { findOne: backgroundJobFindOne, findOneAndUpdate: backgroundJobFindOneAndUpdate, create: jest.fn() },
  BACKGROUND_JOB_STATUS: ["pending", "queued", "running", "completed", "failed", "not_scheduled"],
  TERMINAL_BACKGROUND_JOB_STATUS: ["completed", "failed", "not_scheduled"],
}));

// The retry path is the only caller of the queue in this suite, so the queue is
// mocked here to make refusal and genuine faults expressible. The service
// transitions it drives are the real ones.
jest.unstable_mockModule("../../utils/jobQueue.js", () => ({
  jobQueue: { enqueue: queueEnqueue },
  enqueueTrackedJob: jest.fn(),
  BACKGROUND_QUEUE_NAME: "athenaeum-background-jobs",
}));

const {
  getBackgroundJobStatus,
  retryBackgroundJob,
} = await import("../../controllers/backgroundJobController.js");
const { QueueEnqueueError } = await import("../../utils/errors.js");

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const storedJob = (overrides = {}) => ({
  _id: "job-1",
  user: USER_ID,
  type: "INDEX_MATERIAL",
  status: "running",
  resource: { materialId: "material-1", quizId: "quiz-1", attemptId: null },
  queueJobId: "bull-77",
  error: { code: null, message: null },
  startedAt: new Date("2026-05-01T09:00:05.000Z"),
  completedAt: null,
  createdAt: new Date("2026-05-01T09:00:00.000Z"),
  ...overrides,
});

const buildResponse = () => ({
  statusCode: null,
  body: null,
  json(payload) { this.body = payload; return this; },
});

const request = (userId = USER_ID, params = { id: "job-1" }) => ({
  user: { _id: userId },
  requestId: "req-1",
  params,
});

const drive = async (req = request()) => {
  const res = buildResponse();
  const next = jest.fn();
  await getBackgroundJobStatus(req, res, next);
  return { res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  backgroundJobFindOne.mockImplementation(() => ({ lean: async () => storedJob() }));
});

describe("GET /api/v1/jobs/:id", () => {
  test("returns the documented status shape for the owner", async () => {
    const { res, next } = await drive();

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      jobId: "job-1",
      type: "INDEX_MATERIAL",
      status: "running",
      createdAt: expect.any(Date),
      startedAt: expect.any(Date),
      completedAt: null,
      resource: { materialId: "material-1", quizId: "quiz-1", attemptId: null },
      error: null,
    });
  });

  test("never exposes the queue's own job id", async () => {
    const { res } = await drive();

    expect(res.body).not.toHaveProperty("queueJobId");
    expect(JSON.stringify(res.body)).not.toMatch(/bull-77/);
  });

  test("scopes the lookup to the authenticated learner", async () => {
    await drive();

    expect(backgroundJobFindOne).toHaveBeenCalledWith({ _id: "job-1", user: USER_ID });
  });

  test("another learner cannot read the job by id", async () => {
    // The owner filter is part of the lookup, so the record is not found.
    backgroundJobFindOne.mockImplementation(() => ({ lean: async () => null }));

    const { res, next } = await drive(request(OTHER_USER_ID));

    expect(backgroundJobFindOne.mock.calls[0][0].user).toBe(OTHER_USER_ID);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Background job not found" }));
    expect(res.body).toBeNull();
  });

  test("an unknown job id is a not-found", async () => {
    backgroundJobFindOne.mockImplementation(() => ({ lean: async () => null }));

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Background job not found",
      statusCode: 404,
    }));
    expect(res.body).toBeNull();
  });

  test("a failed job reports only its safe error", async () => {
    backgroundJobFindOne.mockImplementation(() => ({
      lean: async () => storedJob({
        status: "failed",
        completedAt: new Date("2026-05-01T09:00:30.000Z"),
        error: { code: "JOB_FAILED", message: "Background work of type INDEX_MATERIAL did not complete." },
      }),
    }));

    const { res } = await drive();

    expect(res.body.status).toBe("failed");
    expect(res.body.error).toEqual({
      code: "JOB_FAILED",
      message: "Background work of type INDEX_MATERIAL did not complete.",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|redis|\/app\/|ECONNREFUSED/i);
  });

  test("an unscheduled job is visible as such rather than as queued work", async () => {
    backgroundJobFindOne.mockImplementation(() => ({
      lean: async () => storedJob({
        status: "not_scheduled",
        completedAt: new Date("2026-05-01T09:00:02.000Z"),
        error: { code: "QUEUE_ENQUEUE_FAILED", message: "Background work could not be scheduled." },
      }),
    }));

    const { res } = await drive();

    expect(res.body.status).toBe("not_scheduled");
    expect(res.body.error.code).toBe("QUEUE_ENQUEUE_FAILED");
    expect(res.body.completedAt).toEqual(expect.any(Date));
  });

  test("a completed job reports its completion time", async () => {
    const completedAt = new Date("2026-05-01T09:01:00.000Z");
    backgroundJobFindOne.mockImplementation(() => ({
      lean: async () => storedJob({ status: "completed", completedAt, error: { code: null, message: null } }),
    }));

    const { res } = await drive();

    expect(res.body).toMatchObject({ status: "completed", completedAt, error: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry contract.
//
// The service transition is driven through a small fake store rather than a
// stub, so the conditional status filter is genuinely exercised: a retry that has
// already moved the record out of a terminal status must not match a second time.
// That is the property the whole endpoint's concurrency safety rests on.
// ─────────────────────────────────────────────────────────────────────────────

let db = { job: null };

const seedJob = (overrides = {}) => {
  db.job = {
    _id: "job-1",
    user: USER_ID,
    type: "SYNC_ATTEMPT",
    status: "failed",
    resource: { materialId: null, quizId: "quiz-1", attemptId: "attempt-1" },
    queueJobId: "bull-77",
    error: { code: "JOB_FAILED", message: "Background work failed." },
    startedAt: new Date("2026-05-01T09:00:05.000Z"),
    completedAt: new Date("2026-05-01T09:01:00.000Z"),
    createdAt: new Date("2026-05-01T09:00:00.000Z"),
    ...overrides,
  };
  return db.job;
};

const buildRetryResponse = () => ({
  statusCode: null,
  body: null,
  json(payload) { this.body = payload; return this; },
});

const retryRequest = (userId = USER_ID, params = { id: "job-1" }, body = {}) => ({
  user: { _id: userId },
  requestId: "req-1",
  params,
  body,
});

const retry = async (req = retryRequest()) => {
  const res = buildRetryResponse();
  const next = jest.fn();
  await retryBackgroundJob(req, res, next);
  return { res, next };
};

describe("POST /api/v1/jobs/:id/retry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db = { job: null };

    // Owner-scoped read.
    backgroundJobFindOne.mockImplementation((filter) => ({
      lean: async () =>
        db.job &&
        String(db.job._id) === String(filter._id) &&
        String(db.job.user) === String(filter.user)
          ? db.job
          : null,
    }));

    // Honours the caller's status filter, so a conditional update that no longer
    // matches returns null exactly as the database would.
    backgroundJobFindOneAndUpdate.mockImplementation(async (filter, update) => {
      if (!db.job) return null;
      const allowed = filter.status?.$in;
      if (allowed && !allowed.includes(db.job.status)) return null;
      db.job = { ...db.job, ...update.$set };
      return db.job;
    });

    queueEnqueue.mockResolvedValue({ id: "bull-99" });
  });

  test("retries an owner's terminal failed job", async () => {
    seedJob({ status: "failed" });
    const { res, next } = await retry();

    expect(next).not.toHaveBeenCalled();
    expect(res.body.status).toBe("queued");
    expect(res.body.jobId).toBe("job-1");
    expect(queueEnqueue).toHaveBeenCalledTimes(1);
  });

  test("retries an owner's terminal not_scheduled job", async () => {
    seedJob({ status: "not_scheduled" });
    const { res } = await retry();

    expect(res.body.status).toBe("queued");
    expect(queueEnqueue).toHaveBeenCalledTimes(1);
  });

  test("records the new BullMQ job id on the same record", async () => {
    seedJob();
    await retry();

    expect(db.job.queueJobId).toBe("bull-99");
  });

  test("clears the previous terminal error and completion time", async () => {
    seedJob();
    await retry();

    // completedAt carries the retention TTL, so a re-run must not keep it.
    expect(db.job.completedAt).toBeNull();
    expect(db.job.error).toEqual({ code: null, message: null });
  });

  test("another user cannot retry the job", async () => {
    seedJob();
    const { res, next } = await retry(retryRequest(OTHER_USER_ID));

    expect(queueEnqueue).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
    expect(db.job.status).toBe("failed");
  });

  test.each(["completed", "pending", "queued", "running"])(
    "rejects a %s job",
    async (status) => {
      seedJob({ status });
      const { res, next } = await retry();

      expect(queueEnqueue).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0].statusCode).toBe(409);
      expect(db.job.status).toBe(status);
    },
  );

  test.each(["INDEX_MATERIAL", "REBUILD_REVIEW_QUEUE"])(
    "rejects the unsupported job type %s",
    async (type) => {
      seedJob({ type });
      const { next } = await retry();

      expect(queueEnqueue).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0].statusCode).toBe(400);
      expect(db.job.status).toBe("failed");
    },
  );

  test("rejects a job that records no attempt", async () => {
    seedJob({ resource: { materialId: null, quizId: "quiz-1", attemptId: null } });
    const { next } = await retry();

    expect(queueEnqueue).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  test("builds the payload from the persisted resource", async () => {
    seedJob();
    await retry();

    const [name, payload, options] = queueEnqueue.mock.calls[0];
    expect(name).toBe(`SYNC_ATTEMPT - User ${USER_ID}`);
    expect(payload).toEqual({
      type: "SYNC_ATTEMPT",
      data: { attemptId: "attempt-1", userId: USER_ID, quizId: "quiz-1" },
      jobId: "job-1",
    });
    // Deduplication keeps the repository's existing identity, and no explicit
    // BullMQ job id is supplied.
    expect(options).toEqual({ deduplicationId: "sync-attempt:attempt-1" });
  });

  test("ignores resource identifiers supplied in the request body", async () => {
    seedJob();
    await retry(
      retryRequest(USER_ID, { id: "job-1" }, {
        attemptId: "someone-elses-attempt",
        quizId: "someone-elses-quiz",
        userId: OTHER_USER_ID,
      }),
    );

    const [, payload] = queueEnqueue.mock.calls[0];
    expect(payload.data.attemptId).toBe("attempt-1");
    expect(payload.data.quizId).toBe("quiz-1");
    expect(payload.data.userId).toBe(USER_ID);
  });

  test("concurrent retries produce exactly one transition and one enqueue", async () => {
    seedJob({ status: "not_scheduled" });

    const [first, second] = await Promise.all([retry(), retry()]);

    // Exactly one request reaches the queue; the other is told the job is no
    // longer retryable, because the winner already moved it out of terminal.
    const outcomes = [first, second]
      .map((r) => r.next.mock.calls[0]?.[0]?.statusCode ?? 200)
      .sort((a, b) => a - b);
    expect(outcomes).toEqual([200, 409]);
    expect(queueEnqueue).toHaveBeenCalledTimes(1);
    expect(db.job.status).toBe("queued");
  });

  test("reports a queue refusal as not_scheduled rather than queued", async () => {
    seedJob();
    queueEnqueue.mockRejectedValueOnce(new QueueEnqueueError("Redis is down."));

    const { res, next } = await retry();

    expect(next).not.toHaveBeenCalled();
    expect(res.body.status).toBe("not_scheduled");
    expect(db.job.status).toBe("not_scheduled");
    expect(db.job.queueJobId).toBeNull();
  });

  test("does not swallow a non-queue fault", async () => {
    seedJob();
    const boom = new Error("programming fault");
    queueEnqueue.mockRejectedValueOnce(boom);

    const { res, next } = await retry();

    expect(res.body).toBeNull();
    expect(next.mock.calls[0][0]).toBe(boom);
    // The record is still made honest rather than stranded in `pending`.
    expect(db.job.status).toBe("not_scheduled");
  });

  test("supplies no explicit BullMQ job id", async () => {
    seedJob();
    await retry();

    const [, , options] = queueEnqueue.mock.calls[0];
    expect(options).not.toHaveProperty("jobId");
  });
});
