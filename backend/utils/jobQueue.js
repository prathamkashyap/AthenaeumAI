import { Queue } from "bullmq";
import Redis from "ioredis";
import logger from "./logger.js";
import { QueueEnqueueError } from "./errors.js";
import {
  createBackgroundJob,
  markJobQueued,
  markJobNotScheduled,
} from "../services/backgroundJobService.js";

export const BACKGROUND_QUEUE_NAME = "athenaeum-background-jobs";

const isQueueDisabled =
  process.env.NODE_ENV === "test" && process.env.ENABLE_JOB_QUEUE !== "true";

const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  // Retain enough history for operational diagnosis without unbounded Redis growth.
  removeOnComplete: { count: 500, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 500, age: 30 * 24 * 60 * 60 },
});

const redisConnection = isQueueDisabled ? null : new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

redisConnection?.on("error", (error) => {
  logger.warn("[JobQueue] Redis connection error.", { error: error.message });
});

export const backgroundQueue = isQueueDisabled ? null : new Queue(BACKGROUND_QUEUE_NAME, {
  connection: redisConnection,
});

export const createJobQueue = ({ queue = backgroundQueue, testMode = isQueueDisabled } = {}) => ({
  enqueue: async (taskName, payload, options = {}) => {
    if (typeof payload === "function") {
      throw new QueueEnqueueError(
        `Cannot enqueue function directly for ${taskName}. Background payloads must be serializable.`
      );
    }

    if (testMode) {
      return {
        id: `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: taskName,
        data: payload,
        opts: { ...DEFAULT_JOB_OPTIONS },
      };
    }

    if (!queue) {
      throw new QueueEnqueueError("Background queue is not configured.");
    }

    try {
      const job = await queue.add(taskName, payload, {
        ...DEFAULT_JOB_OPTIONS,
        ...(options.attempts !== undefined ? { attempts: options.attempts } : {}),
        ...(options.backoff ? { backoff: options.backoff } : {}),
        ...(options.deduplicationId
          ? { deduplication: { id: options.deduplicationId } }
          : {}),
      });
      logger.info(`[JobQueue] Enqueued task: "${taskName}" to BullMQ.`, {
        jobId: job.id,
        queue: BACKGROUND_QUEUE_NAME,
        type: payload?.type,
      });
      return job;
    } catch (error) {
      logger.error(`[JobQueue] Failed to enqueue task: "${taskName}".`, {
        error: error.message,
      });
      throw new QueueEnqueueError(
        "Background processing could not be scheduled. Please retry the request.",
        error
      );
    }
  },
});

export const jobQueue = createJobQueue();

/**
 * Schedules background work as a tracked application-level job.
 *
 * The ordering is the whole point of this helper, and it is fixed here rather than
 * at each call site so no caller can get it wrong:
 *
 *   1. a job record is created as `pending` — it exists, but nothing is claimed
 *   2. the queue is asked to accept the work
 *   3. on success the record becomes `queued`; on refusal it becomes
 *      `not_scheduled`
 *
 * A job is therefore never reported as queued when the enqueue actually failed,
 * and a refusal leaves a durable, queryable trace instead of a silent gap. This
 * is deliberately not a transactional outbox: the business record was committed
 * first, and a failed enqueue is surfaced as `not_scheduled` for operational
 * recovery rather than being papered over.
 *
 * @returns {Promise<{ job: object|null, scheduled: boolean, error: Error|null }>}
 */
export const enqueueTrackedJob = async ({
  createJobQueue: createJobQueueImpl = jobQueue,
  user,
  type,
  data,
  resource = {},
  deduplicationId,
  name,
}) => {
  const job = await createBackgroundJob({ user, type, resource });

  try {
    const queued = await createJobQueueImpl.enqueue(name, { type, data, jobId: String(job._id) }, {
      ...(deduplicationId ? { deduplicationId } : {}),
    });
    await markJobQueued(job._id, queued?.id ?? null);
    return { job, scheduled: true, error: null };
  } catch (error) {
    // Only a queue refusal means "committed but unscheduled". Any other failure
    // is a real fault and is rethrown, so a bug is never recorded as a scheduling
    // problem and never presented to the client as one.
    if (!(error instanceof QueueEnqueueError)) throw error;

    // The refusal is recorded on the job, and the original error is still returned
    // so the caller can log it and decide what its response should say.
    await markJobNotScheduled(job._id, {
      code: "QUEUE_ENQUEUE_FAILED",
      message: "Background work could not be scheduled.",
    }).catch((recordError) => {
      logger.error("[JobQueue] Failed to record an unscheduled job.", {
        error: recordError.message,
      });
    });
    return { job, scheduled: false, error };
  }
};



export default jobQueue;
