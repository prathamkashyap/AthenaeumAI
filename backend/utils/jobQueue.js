import { Queue } from "bullmq";
import Redis from "ioredis";
import logger from "./logger.js";
import { QueueEnqueueError } from "./errors.js";

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

export default jobQueue;
