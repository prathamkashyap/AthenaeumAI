/**
 * Combined entry point: the API and the BullMQ worker in one process.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * Render has no free compute plan for a Background Worker, so a free deployment
 * cannot run the worker as its own service. Running both in one web service keeps
 * the queue intact: jobs are still enqueued, still tracked in MongoDB, still
 * retried, and still executed by a real BullMQ consumer. Nothing about the job
 * semantics changes — only which process hosts the consumer.
 *
 * The alternative, folding the work into HTTP request handlers, was rejected: it
 * would make a two-minute quiz generation occupy a request, lose the durable job
 * record, and remove the retry and terminal-state behaviour the system relies on.
 *
 * ── Shutdown ──────────────────────────────────────────────────────────────────
 * One signal, one owner. `startServer` and `startWorker` deliberately do not
 * register their own handlers, so SIGTERM tears the worker down first (letting
 * in-flight jobs finish), then drains HTTP, then closes the database, then exits.
 *
 * Used by: Render's free web service (`startCommand: node main.js`).
 * The standalone entry points `node server.js` and `node worker.js` are unchanged
 * and still work on their own — Compose and local development use those.
 */

import "./config/env.js"; // Validate configuration before anything else connects.
import mongoose from "mongoose";
import connectDB from "./config/database.js";
import logger from "./utils/logger.js";
import { startWorker } from "./worker.js";
import { startServer } from "./server.js";

// Force-exit backstop. A stuck BullMQ job must not hold a deploy open forever, so
// shutdown always has a ceiling, exactly as the standalone API entry point has.
const SHUTDOWN_TIMEOUT_MS = 30000;

const bootstrap = async () => {
  await connectDB();

  // Worker first: it owns in-flight jobs, so it needs the longest runway.
  // `connectDatabase: false` because this process already connected above.
  const worker = await startWorker({ connectDatabase: false });
  const http = await startServer();

  logger.info("Combined API + worker process ready.", {
    workerConcurrency: 5,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  });

  let shuttingDown = false;

  const shutdown = async (signal) => {
    // A platform can deliver SIGTERM and SIGINT together during a restart. The
    // second one must not start a second teardown.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received. Draining the worker, then HTTP...`);

    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out. Forcing exit.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await worker.close();
      logger.info("Worker drained. Closing the HTTP server...");

      await new Promise((resolve) => http.close(resolve));
      logger.info("HTTP server closed. Closing database connections...");

      await mongoose.connection.close();
      logger.info("Shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error("Error during shutdown:", { error: err.message });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

bootstrap().catch((err) => {
  logger.error("Failed to start the combined API + worker process", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
