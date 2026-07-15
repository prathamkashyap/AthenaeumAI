import { Worker, QueueEvents } from "bullmq";
import Redis from "ioredis";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import connectDB from "./config/database.js";
import logger from "./utils/logger.js";
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
  const redisConnection = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  });

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

    await updateUserProgressFromAttempt({ userId, quiz, attempt });
    await recordAttemptEvents({ userId, quiz, attempt });
    if (attempt.score < attempt.total) {
      const mistakeAnalyses = attempt.mistakeAnalyses?.length
        ? attempt.mistakeAnalyses
        : await analyzeMistakesForAttempt({
          quiz,
          normalizedAnswers: attempt.answers,
          limit: 5,
        });
      await enqueueFailedQuestionItems({ userId, quiz, attempt, mistakeAnalyses });
    }
    await rebuildReviewQueueForUser(userId);

    return { type, attemptId: String(attemptId), quizId: String(quizId) };
  }

  if (type === "REBUILD_REVIEW_QUEUE") {
    const userId = requireJobValue(data.userId, "userId");
    await rebuildReviewQueueForUser(userId);
    return { type, userId: String(userId) };
  }

  throw new Error(`Unknown background job type: ${type}`);
};

export const startWorker = async () => {
  await connectDB();
  logger.info("🚀 Worker connected to MongoDB");

  const redisConnection = createRedisConnection();

  const worker = new Worker(QUEUE_NAME, async (job) => {
    logger.info(`[JobWorker] Starting job ${job.name} (ID: ${job.id})`);

    try {
      return await processBackgroundJob(job);
    } catch (error) {
      logger.error(`[JobWorker] Job failed: ${job.name}`, { error: error.message, stack: error.stack });
      throw error;
    }
  }, { 
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

  // Graceful shutdown
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, closing worker gracefully...`);
    await worker.close();
    await queueEvents.close();
    await redisConnection.quit();
    await mongoose.connection.close();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
};

const isMainModule = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  startWorker().catch((err) => {
    logger.error("Failed to start worker", { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
