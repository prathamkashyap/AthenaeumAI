import BackgroundJob, { TERMINAL_BACKGROUND_JOB_STATUS } from "../models/BackgroundJob.js";
import logger from "../utils/logger.js";

/**
 * Application-level lifecycle for background work.
 *
 * Every transition is a conditional update that refuses to move a job out of a
 * terminal state. That is what makes the record safe under BullMQ's retries and
 * under a duplicated or out-of-order worker event: a late `running` can never
 * resurrect a job that already completed, so a stale event degrades to a no-op
 * rather than corrupting the reported state.
 *
 * Nothing here is a correctness boundary for the work itself. `SYNC_ATTEMPT`
 * idempotency remains the durable claim taken on `QuizAttempt` inside the business
 * transaction; this record only describes what happened to the submission.
 */

/** Statuses a job can still legitimately move on from. */
const OPEN_STATUSES = ["pending", "queued", "running"];

const conditionalUpdate = (jobId, filter, update) =>
  BackgroundJob.findOneAndUpdate(
    { _id: jobId, status: { $in: OPEN_STATUSES }, ...filter },
    update,
    { new: true },
  );

export const createBackgroundJob = async ({ user, type, resource = {} }) =>
  BackgroundJob.create({ user, type, resource, status: "pending" });

export const markJobQueued = async (jobId, queueJobId = null) =>
  conditionalUpdate(jobId, {}, { $set: { status: "queued", queueJobId } });

/**
 * Records that the queue refused the work.
 *
 * This is the state that keeps Task 12's promise honest: the job exists, the
 * business record exists, and the background work demonstrably did not start.
 */
export const markJobNotScheduled = async (jobId, { code = "QUEUE_ENQUEUE_FAILED", message = "Background work could not be scheduled." } = {}) =>
  conditionalUpdate(jobId, {}, {
    $set: {
      status: "not_scheduled",
      completedAt: new Date(),
      error: { code, message },
    },
  });

export const markJobRunning = async (jobId) =>
  conditionalUpdate(jobId, {}, { $set: { status: "running", startedAt: new Date() } });

export const markJobCompleted = async (jobId, { result = null } = {}) => {
  const doc = await conditionalUpdate(jobId, {}, {
    $set: { status: "completed", completedAt: new Date(), error: { code: null, message: null } },
  });
  if (result !== null && doc) {
    logger.debug("Background job completed with a result.", { jobId: String(jobId) });
  }
  return doc;
};

export const markJobFailed = async (jobId, { code = "JOB_FAILED", message = "Background work failed." } = {}) =>
  conditionalUpdate(jobId, {}, {
    $set: { status: "failed", completedAt: new Date(), error: { code, message } },
  });

/** The statuses a learner is allowed to ask to have re-run. */
export const RETRYABLE_BACKGROUND_JOB_STATUS = Object.freeze(["failed", "not_scheduled"]);

/**
 * Claims a terminal job for a retry, returning it to `pending`.
 *
 * This is the one transition that deliberately does not use `conditionalUpdate`,
 * because that helper only matches open statuses and a terminal job matches none
 * of them. The terminal statuses are named explicitly instead of being opened up,
 * so `pending`, `queued`, `running` and `completed` all remain unclaimable and the
 * guard on every other transition is untouched.
 *
 * The conditional match is also the concurrency boundary. Two retries racing for
 * the same job cannot both win: the first moves the record to `pending`, and the
 * loser's filter no longer matches because `pending` is not retryable. A
 * pre-check in the caller would not be sufficient on its own, since two requests
 * could both pass it before either wrote.
 *
 * `pending` is reused rather than inventing a retry-specific status because it
 * already means exactly this: the record exists and nothing has claimed it. That
 * lets the ordinary `markJobQueued` / `markJobNotScheduled` transitions finish
 * the lifecycle unchanged.
 *
 * `completedAt` is cleared because it carries the retention TTL index: a job that
 * is queued again must not still be scheduled for deletion. `error` is cleared so
 * a re-run does not keep reporting the previous attempt's cause, and
 * `startedAt`/`queueJobId` are cleared so nothing implies a delivery is in
 * flight before one exists.
 */
export const claimTerminalJobForRetry = (jobId) =>
  BackgroundJob.findOneAndUpdate(
    { _id: jobId, status: { $in: [...RETRYABLE_BACKGROUND_JOB_STATUS] } },
    {
      $set: {
        status: "pending",
        error: { code: null, message: null },
        completedAt: null,
        startedAt: null,
        queueJobId: null,
      },
    },
    { new: true },
  );

/**
 * Reads a job for its owner.
 *
 * Scoped by user as well as id, so a job identifier alone can never retrieve
 * another learner's job. Returns null rather than a record when the id is unknown
 * *or* belongs to somebody else, which keeps them indistinguishable from outside.
 */
export const getBackgroundJobForUser = async (jobId, userId) =>
  BackgroundJob.findOne({ _id: jobId, user: userId }).lean();

/** The client-facing projection. BullMQ's job id is deliberately excluded. */
export const toPublicJob = (job) => ({
  jobId: String(job._id),
  type: job.type,
  status: job.status,
  createdAt: job.createdAt,
  startedAt: job.startedAt ?? null,
  completedAt: job.completedAt ?? null,
  resource: {
    materialId: job.resource?.materialId ? String(job.resource.materialId) : null,
    quizId: job.resource?.quizId ? String(job.resource.quizId) : null,
    attemptId: job.resource?.attemptId ? String(job.resource.attemptId) : null,
  },
  error: job.status === "failed" || job.status === "not_scheduled"
    ? { code: job.error?.code ?? null, message: job.error?.message ?? null }
    : null,
});

export { TERMINAL_BACKGROUND_JOB_STATUS };
