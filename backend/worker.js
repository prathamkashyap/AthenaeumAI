import { Worker, QueueEvents } from "bullmq";
import { createRedisClient } from "./utils/redisConnection.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import connectDB from "./config/database.js";
import logger from "./utils/logger.js";
import { runInTransaction } from "./utils/dbTransactions.js";
import { markJobRunning, markJobCompleted, markJobFailed } from "./services/backgroundJobService.js";
import { indexStudyMaterialChunks } from "./services/embeddingService.js";
import { updateUserProgressFromAttempt } from "./services/progressService.js";
import { recordAttemptEvents } from "./services/learningEventService.js";
import { analyzeMistakesForAttempt } from "./services/mistakeAnalysisService.js";
import {
  enqueueFailedQuestionItems,
  rebuildReviewQueueForUser,
} from "./services/reviewQueueService.js";
import StudyMaterial from "./models/StudyMaterial.js";
import Quiz from "./models/Quiz.js";
import QuizAttempt from "./models/QuizAttempt.js";

dotenv.config();

const QUEUE_NAME = "athenaeum-background-jobs";

const createRedisConnection = () => {
  const redisConnection = createRedisClient({ maxRetriesPerRequest: null });

  redisConnection.on("error", (error) => {
    logger.warn("[JobWorker] Redis connection error.", { error: error.message });
  });

  return redisConnection;
};

const requireJobValue = (value, label) => {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Background job is missing ${label}.`);
  }
  return value;
};

export const isAttemptSynced = (attempt) => attempt?.sync?.status === "processed";

/**
 * Durably claims a quiz attempt for the application of its learner effects.
 *
 * The claim is a conditional update on the attempt document itself, so MongoDB
 * guarantees that exactly one caller can move it away from "pending". Because it
 * runs inside the caller's transaction, a crash anywhere in the effect
 * application rolls the claim back with it and the next delivery simply claims
 * the attempt again.
 */
const claimAttemptForSync = (attemptId, session) =>
  QuizAttempt.findOneAndUpdate(
    { _id: attemptId, "sync.status": { $ne: "processed" } },
    { $set: { "sync.status": "processed", "sync.appliedAt": new Date() } },
    { new: true, session }
  );

/**
 * Applies one logical quiz attempt to the learner exactly once.
 *
 * Returns true when this call applied the effects, false when the attempt had
 * already been applied and the delivery was therefore a no-op.
 */
export const syncAttemptOnce = async ({ attempt, quiz, userId }) => {
  return runInTransaction(async (session) => {
    const claimed = await claimAttemptForSync(attempt._id, session);
    if (!claimed) return false;

    await updateUserProgressFromAttempt({ userId, quiz, attempt, session });
    await recordAttemptEvents({ userId, quiz, attempt, session });
    return true;
  });
};

/**
 * Reduces an internal failure to something safe to store on, and return from, a
 * job record. The underlying cause is already logged by the worker; the client
 * only ever learns that the background work failed.
 */
export const clientSafeFailure = (job) => ({
  code: "JOB_FAILED",
  message: `Background work of type ${job.data?.type ?? "unknown"} did not complete.`,
});

/**
 * Whether this attempt is the job's last one under BullMQ's own retry budget.
 *
 * Only the final failure is an outcome: an intermediate attempt that will be
 * retried must not be recorded as the result, or the status would report a
 * failure for work that is still going to run.
 */
export const isFinalJobAttempt = (job) =>
  (job?.attemptsMade || 0) >= (job?.opts?.attempts ?? 1);

export const processBackgroundJob = async (job) => {
  const { type, data } = job?.data || {};
  requireJobValue(type, "type");
  requireJobValue(data, "data");

  if (type === "INDEX_MATERIAL") {
    const materialId = requireJobValue(data.materialId, "materialId");
    const material = await StudyMaterial.findById(materialId);
    if (!material) {
      throw new Error(`Study material ${materialId} was not found for indexing.`);
    }

    const chunks = await indexStudyMaterialChunks(material);
    if (!chunks.length) {
      throw new Error(`Study material ${materialId} produced no indexable chunks.`);
    }

    return { type, materialId: String(materialId), chunkCount: chunks.length };
  }

  if (type === "SYNC_ATTEMPT") {
    const attemptId = requireJobValue(data.attemptId, "attemptId");
    const userId = requireJobValue(data.userId, "userId");
    const quizId = requireJobValue(data.quizId, "quizId");
    const attempt = await QuizAttempt.findById(attemptId);
    const quiz = await Quiz.findById(quizId);

    if (!attempt) {
      throw new Error(`Quiz attempt ${attemptId} was not found for synchronization.`);
    }
    if (!quiz) {
      throw new Error(`Quiz ${quizId} was not found for attempt synchronization.`);
    }
    if (String(attempt.user) !== String(userId)) {
      throw new Error(`Quiz attempt ${attemptId} does not belong to user ${userId}.`);
    }

    // Mistake analysis calls the AI provider, so it runs before the transaction
    // rather than inside it.
    const resolveMistakeAnalyses = async () => {
      if (attempt.mistakeAnalyses?.length) return attempt.mistakeAnalyses;
      if (attempt.score >= attempt.total) return null;
      return analyzeMistakesForAttempt({
        quiz,
        normalizedAnswers: attempt.answers,
        limit: 5,
      });
    };

    /**
     * The review-queue effects that necessarily sit *after* the commit.
     *
     * They are deliberately not transactional: a redelivery must never redo the
     * claim. That separation is also why they cannot simply be assumed to have
     * run. The durable claim asserts that the learning effects committed, not
     * that these did, so a worker that dies between the commit and here leaves
     * the queue incomplete while the attempt still reads as fully applied.
     * Replaying them on every delivery closes that window, and converges rather
     * than accumulating, because the queue is written by upsert and the rebuild
     * is recomputed from progress.
     */
    const applyPostCommitReviewQueueEffects = async (mistakeAnalyses) => {
      if (mistakeAnalyses) {
        await enqueueFailedQuestionItems({ userId, quiz, attempt, mistakeAnalyses });
      }
      await rebuildReviewQueueForUser(userId);
    };

    // Cheap pre-check that keeps a redelivery from opening a transaction. It is
    // only an optimisation: the claim inside syncAttemptOnce is the correctness
    // boundary, so a stale read here can never skip an unapplied attempt.
    //
    // Returning early is not sufficient on its own. The effects that follow the
    // commit are outside the transaction, so "already processed" is not evidence
    // that they ran.
    if (isAttemptSynced(attempt)) {
      await applyPostCommitReviewQueueEffects(await resolveMistakeAnalyses());
      return {
        type,
        attemptId: String(attemptId),
        quizId: String(quizId),
        applied: false,
        duplicate: true,
      };
    }

    const mistakeAnalyses = await resolveMistakeAnalyses();

    const applied = await syncAttemptOnce({ attempt, quiz, userId });
    if (!applied) {
      await applyPostCommitReviewQueueEffects(mistakeAnalyses);
      return {
        type,
        attemptId: String(attemptId),
        quizId: String(quizId),
        applied: false,
        duplicate: true,
      };
    }

    await applyPostCommitReviewQueueEffects(mistakeAnalyses);

    return {
      type,
      attemptId: String(attemptId),
      quizId: String(quizId),
      applied: true,
      duplicate: false,
    };
  }

  if (type === "REBUILD_REVIEW_QUEUE") {
    const userId = requireJobValue(data.userId, "userId");
    await rebuildReviewQueueForUser(userId);
    return { type, userId: String(userId) };
  }

  throw new Error(`Unknown background job type: ${type}`);
};

/**
 * Runs one job and maintains its application-level status.
 *
 * Extracted from the BullMQ worker callback so the tracking behaviour is testable
 * without a live Redis. The processor is injectable for the same reason; the
 * default is the real dispatcher.
 */
export const runJobWithStatusTracking = async (job, { process = processBackgroundJob } = {}) => {
  logger.info(`[JobWorker] Starting job ${job.name} (ID: ${job.id})`);

  // Application-level job state is derived from real worker execution, not from
  // the queue's own bookkeeping, so the status a client reads afterwards still
  // means something once the request that created the work is long gone.
  const applicationJobId = job.data?.jobId;
  if (applicationJobId) await markJobRunning(applicationJobId).catch(() => {});

  let failed = false;
  try {
    return await process(job);
  } catch (error) {
    failed = true;
    logger.error(`[JobWorker] Job failed: ${job.name}`, { error: error.message, stack: error.stack });
    throw error;
  } finally {
    if (applicationJobId) {
      // A success is always terminal: the queue does not retry a job that
      // finished. Only a failure is gated on the retry budget, so an intermediate
      // attempt that will be retried is never recorded as the outcome. Neither
      // transition may overwrite a state that is already terminal.
      if (!failed) {
        const settled = await markJobCompleted(applicationJobId).catch(() => null);
        logger.info(`[JobWorker] Application job settled as ${settled?.status ?? "unchanged"}`, {
          applicationJobId,
          bullmqJobId: job.id,
        });
      } else if (isFinalJobAttempt(job)) {
        const settled = await markJobFailed(applicationJobId, clientSafeFailure(job)).catch(() => null);
        logger.info(`[JobWorker] Application job settled as ${settled?.status ?? "unchanged"}`, {
          applicationJobId,
          bullmqJobId: job.id,
        });
      }
    }
  }
};

/**
 * Starts the BullMQ worker and returns a handle for stopping it.
 *
 * Deliberately does NOT register process signal handlers. When the worker runs as
 * its own process (`node worker.js`, as Compose and the standalone Render worker
 * do) the entry point below owns shutdown. When it shares a process with the API
 * (`node main.js`) that entry point owns shutdown for both, so a single signal
 * has a single owner and cannot race two `process.exit` paths.
 *
 * @param connectDatabase Set false when the caller has already connected, as
 *   `main.js` does. Left true for the standalone entry point.
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export const startWorker = async ({ connectDatabase = true } = {}) => {
  if (connectDatabase) {
    await connectDB();
  }
  logger.info("🚀 Worker connected to MongoDB");

  const redisConnection = createRedisConnection();

  const worker = new Worker(QUEUE_NAME, (job) => runJobWithStatusTracking(job), {
    connection: redisConnection,
    concurrency: 5
  });

  const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redisConnection });

  queueEvents.on("completed", ({ jobId }) => {
    logger.info(`[JobWorker] Completed job ${jobId}`);
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    logger.error(`[JobWorker] Failed job ${jobId}`, { failedReason });
  });

  queueEvents.on("stalled", ({ jobId }) => {
    logger.warn(`[JobWorker] Stalled job ${jobId}`);
  });

  // Stops the worker without touching process signals or exiting. The caller
  // decides what happens next, so the API and the worker can be torn down in a
  // deliberate order by one owner.
  const close = async () => {
    await worker.close();
    await queueEvents.close();
    await redisConnection.quit();
  };

  return { close };
};

const isMainModule = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  startWorker()
    .then(({ close }) => {
      // Standalone worker process: this entry point owns shutdown.
      const shutdown = async (signal) => {
        logger.info(`Received ${signal}, closing worker gracefully...`);
        try {
          await close();
          await mongoose.connection.close();
          process.exit(0);
        } catch (err) {
          logger.error("Error during worker shutdown:", { error: err.message });
          process.exit(1);
        }
      };
      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((err) => {
      logger.error("Failed to start worker", { error: err.message, stack: err.stack });
      process.exit(1);
    });
}
