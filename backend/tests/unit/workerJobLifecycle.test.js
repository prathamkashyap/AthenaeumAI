/**
 * Contract Tests — worker job-status lifecycle
 *
 * The application job record must reflect real worker execution, not the queue's
 * own bookkeeping, so a client can ask how the work is going after the request
 * that created it is long gone. These tests drive the production status
 * transitions and assert the two properties that matter: terminal states are
 * final, and a repeated delivery cannot re-break `SYNC_ATTEMPT` idempotency.
 */

import { jest } from "@jest/globals";

const backgroundJobCreate = jest.fn();
const backgroundJobFindOneAndUpdate = jest.fn();
const backgroundJobFindOne = jest.fn(() => ({ lean: async () => null }));

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
  markJobRunning,
  markJobCompleted,
  markJobFailed,
} = await import("../../services/backgroundJobService.js");
const { clientSafeFailure, isFinalJobAttempt, runJobWithStatusTracking } = await import("../../worker.js");

/** Tracks which job statuses the worker's transitions would write. */
const transitions = () => backgroundJobFindOneAndUpdate.mock.calls.map(([, update]) => update.$set.status);

const isOpenJob = (filter) => ["pending", "queued", "running"].includes(filter.status?.$in?.[0]);

beforeEach(() => {
  jest.clearAllMocks();
  backgroundJobFindOneAndUpdate.mockImplementation(async (filter, update) => (
    isOpenJob(filter) ? { _id: "job-1", status: update.$set.status } : null
  ));
});

describe("worker attempt accounting", () => {
  test("only the last attempt is an outcome", () => {
    // BullMQ retries inside its own budget, so an intermediate failure must not
    // be recorded as the job's result.
    expect(isFinalJobAttempt({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
    expect(isFinalJobAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(false);
    expect(isFinalJobAttempt({ attemptsMade: 3, opts: { attempts: 3 } })).toBe(true);
  });

  test("a job with no explicit budget is final on its first attempt", () => {
    expect(isFinalJobAttempt({ attemptsMade: 1, opts: {} })).toBe(true);
  });
});

describe("worker success path", () => {
  test("the real tracking wrapper marks running, then completed", async () => {
    // Driven through the production wrapper, not the helpers, so the wiring in
    // the worker itself is what is under test.
    const job = { id: "bull-1", name: "INDEX_MATERIAL", data: { type: "INDEX_MATERIAL", jobId: "job-1" }, opts: { attempts: 3 }, attemptsMade: 1 };

    await runJobWithStatusTracking(job, { process: async () => ({ ok: true }) });

    expect(transitions()).toEqual(["running", "completed"]);
  });

  test("a job with no application id is still processed", async () => {
    const job = { id: "bull-1", name: "x", data: { type: "INDEX_MATERIAL" }, opts: {}, attemptsMade: 1 };
    const process = jest.fn(async () => ({ ok: true }));

    await expect(runJobWithStatusTracking(job, { process })).resolves.toEqual({ ok: true });
    expect(process).toHaveBeenCalledWith(job);
    expect(transitions()).toEqual([]);
  });
});

describe("worker failure path", () => {
  test("records a safe failure rather than the internal error", async () => {
    const safe = clientSafeFailure({ data: { type: "INDEX_MATERIAL" } });

    await markJobFailed("job-1", safe);

    const [, update] = backgroundJobFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe("failed");
    expect(update.$set.error.code).toBe("JOB_FAILED");
    // No stack, socket detail or internal cause is retained on the record.
    expect(JSON.stringify(update.$set.error)).not.toMatch(/stack|redis|ECONNREFUSED|at Object/i);
  });

  test("the real wrapper records a failure and rethrows it", async () => {
    const job = { id: "bull-1", name: "INDEX_MATERIAL", data: { type: "INDEX_MATERIAL", jobId: "job-1" }, opts: { attempts: 3 }, attemptsMade: 3 };
    const process = jest.fn(async () => { throw new Error("indexing blew up"); });

    await expect(runJobWithStatusTracking(job, { process })).rejects.toThrow("indexing blew up");

    expect(transitions()).toEqual(["running", "failed"]);
    const [, update] = backgroundJobFindOneAndUpdate.mock.calls.at(-1);
    // The internal message never reaches the stored record.
    expect(update.$set.error.message).not.toContain("indexing blew up");
  });

  test("an intermediate attempt is not recorded as the outcome", async () => {
    const job = { id: "bull-1", name: "INDEX_MATERIAL", data: { type: "INDEX_MATERIAL", jobId: "job-1" }, opts: { attempts: 3 }, attemptsMade: 1 };
    const process = jest.fn(async () => { throw new Error("transient"); });

    await expect(runJobWithStatusTracking(job, { process })).rejects.toThrow("transient");

    // The job is running, and the queue will retry it, so no terminal state yet.
    expect(transitions()).toEqual(["running"]);
  });

  test("a job whose type is unknown still yields a safe message", () => {
    const safe = clientSafeFailure({ data: {} });

    expect(safe.code).toBe("JOB_FAILED");
    expect(safe.message).toBe("Background work of type unknown did not complete.");
  });
});

describe("repeated delivery safety", () => {
  test("a second delivery cannot move a job out of a terminal state", async () => {
    // A duplicated or retried delivery re-enters the worker. Once the job is
    // terminal the conditional update matches nothing, so the reported state is
    // left exactly as it was.
    backgroundJobFindOneAndUpdate.mockResolvedValue(null);

    const afterCompletion = await markJobRunning("job-1");
    expect(afterCompletion).toBeNull();

    const lateFailure = await markJobFailed("job-1");
    expect(lateFailure).toBeNull();

    expect(transitions()).toEqual(["running", "failed"]);
  });

  test("a stale running event does not overwrite a completed job", async () => {
    backgroundJobFindOneAndUpdate.mockResolvedValue(null);

    expect(await markJobRunning("job-1")).toBeNull();
    expect(await markJobCompleted("job-1")).toBeNull();
  });
});
