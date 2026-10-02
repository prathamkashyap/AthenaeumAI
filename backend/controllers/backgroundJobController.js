import {
  claimTerminalJobForRetry,
  getBackgroundJobForUser,
  markJobNotScheduled,
  markJobQueued,
  RETRYABLE_BACKGROUND_JOB_STATUS,
  toPublicJob,
} from "../services/backgroundJobService.js";
import { jobQueue } from "../utils/jobQueue.js";
import {
  ConflictError,
  NotFoundError,
  QueueEnqueueError,
  ValidationError,
} from "../utils/errors.js";
import logger from "../utils/logger.js";

/**
 * The job types this endpoint will re-run.
 *
 * Only `SYNC_ATTEMPT` qualifies, and the reason is about recoverability rather
 * than convenience. Its learner effects exist only inside the attempt-sync
 * transaction, so once a job ends terminally nothing else can reconstruct them.
 * `INDEX_MATERIAL` is already repaired on read by `ensureChunksForUser` on every
 * search, and `REBUILD_REVIEW_QUEUE` is recomputed from `UserProgress` and has a
 * synchronous endpoint already. Offering those here would add a second, weaker
 * path to work that has a better one.
 */
const RETRYABLE_JOB_TYPES = ["SYNC_ATTEMPT"];

/**
 * Builds the worker payload from the persisted job record.
 *
 * Nothing here reads the request. The identifiers come from the job's own stored
 * resource and its owning user, so a caller cannot redirect a retry at another
 * learner's attempt or quiz by putting ids in the body. The payload shape is the
 * one `processBackgroundJob` already expects, so the worker is untouched.
 */
const buildRetryPayload = (job) => ({
  type: job.type,
  data: {
    attemptId: job.resource.attemptId,
    userId: job.user,
    quizId: job.resource.quizId,
  },
  // The application-level job id the worker reports status against. Reusing this
  // record's id is what keeps a retry tracked by the same row.
  jobId: String(job._id),
});

/**
 * GET /api/v1/jobs/:id
 * Status of one background job, scoped to the authenticated learner.
 *
 * The lookup is by job id *and* owner, so an identifier is never sufficient to
 * read somebody else's job. An id that does not exist and an id owned by another
 * learner are both answered as "not found", so this endpoint cannot be used to
 * probe for the existence of other users' jobs.
 */
export const getBackgroundJobStatus = async (req, res, next) => {
  try {
    const job = await getBackgroundJobForUser(req.params.id, req.user._id);

    if (!job) {
      throw new NotFoundError("Background job not found");
    }

    res.json(toPublicJob(job));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/jobs/:id/retry
 * Re-runs one of the caller's own terminal background jobs.
 *
 * BullMQ has already retried ordinary delivery failures, so this exists only for
 * the jobs that became terminal anyway: `failed` after exhausting those retries,
 * and `not_scheduled` when the queue refused the work outright. Both leave a
 * durable, unapplied business record behind — for `SYNC_ATTEMPT`, an attempt
 * whose progress and learning events were never applied and cannot be rebuilt by
 * reading anything.
 *
 * The existing record is retried rather than a new one created. The claim moves
 * that record to `pending`, and the ordinary queued / not-scheduled transitions
 * then finish it, so a retry is one row with one history rather than a second row
 * that merely looks like the first.
 *
 * No BullMQ `jobId` is supplied, matching every other enqueue in the repository.
 * That is deliberate: BullMQ rejects integer and colon-bearing custom ids
 * outright, and a terminally failed job is still retained under its own id, so
 * reusing an identity is not available. Letting BullMQ allocate one yields exactly
 * one fresh delivery per accepted retry. Deduplication is a separate mechanism and
 * keeps the existing identity: a settled job's dedup key has already been cleared,
 * and a job that was never enqueued never set one.
 */
export const retryBackgroundJob = async (req, res, next) => {
  try {
    const job = await getBackgroundJobForUser(req.params.id, req.user._id);

    // Another learner's job and a job that does not exist are the same answer, so
    // this endpoint cannot be used to probe for other users' jobs.
    if (!job) {
      throw new NotFoundError("Background job not found");
    }

    if (!RETRYABLE_JOB_TYPES.includes(job.type)) {
      throw new ValidationError(
        `Background jobs of type ${job.type} cannot be retried.`,
      );
    }

    if (!job.resource?.attemptId || !job.resource?.quizId) {
      throw new ValidationError(
        "This job does not record the attempt it would retry, so it cannot be retried safely.",
      );
    }

    const claimed = await claimTerminalJobForRetry(job._id);

    // The claim is the concurrency boundary, not this check. A job that is
    // pending, queued, running or completed matched no retryable status and was
    // never claimed; neither was one that another retry claimed a moment earlier.
    if (!claimed) {
      throw new ConflictError(
        `Background job is ${job.status} and cannot be retried.`,
      );
    }

    const payload = buildRetryPayload(job);

    try {
      const queued = await jobQueue.enqueue(
        `${job.type} - User ${job.user}`,
        payload,
        { deduplicationId: `sync-attempt:${job.resource.attemptId}` },
      );

      await markJobQueued(job._id, queued?.id ?? null);

      const settled = await getBackgroundJobForUser(job._id, req.user._id);
      return res.json(toPublicJob(settled ?? claimed));
    } catch (enqueueError) {
      // The claim already moved the record off its terminal status, so the record
      // must be given an honest state either way. Leaving it `pending` would make
      // an unscheduled retry indistinguishable from one that is genuinely in
      // flight, and a pending job is not retryable again.
      const recorded = await markJobNotScheduled(job._id, {
        code: "QUEUE_ENQUEUE_FAILED",
        message: "Background work could not be scheduled.",
      }).catch((recordError) => {
        logger.error("[BackgroundJobs] Failed to record a retry that was not scheduled.", {
          error: recordError.message,
        });
        return null;
      });

      if (!(enqueueError instanceof QueueEnqueueError)) {
        // A genuine fault is not a scheduling problem and must not be reported as
        // one. It is rethrown after the record is made honest, so the job is at
        // least retryable again rather than stranded in `pending`.
        throw enqueueError;
      }

      logger.warn("[BackgroundJobs] Retry was not scheduled.", {
        jobId: String(job._id),
        error: enqueueError.message,
      });

      const settled = await getBackgroundJobForUser(job._id, req.user._id);
      return res.json(toPublicJob(settled ?? recorded ?? claimed));
    }
  } catch (err) {
    next(err);
  }
};
