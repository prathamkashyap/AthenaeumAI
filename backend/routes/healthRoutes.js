import express from "express";
import mongoose from "mongoose";
import { createRedisClient } from "../utils/redisConnection.js";
import { backgroundQueue } from "../utils/jobQueue.js";
import {
  TRANSACTION_SUPPORT,
  getMongoCapabilities,
} from "../config/database.js";
import os from "os";
import process from "process";

const router = express.Router();

router.get("/", async (req, res) => {
  const mongoReadyState = mongoose.connection.readyState;
  const mongoStatus = mongoReadyState === 1 ? "connected" : "disconnected";

  // Connected is not the same as capable. A standalone mongod answers a
  // connection but cannot run the transactions quiz generation and attempt sync
  // depend on, so the deployment is reported as degraded rather than ok.
  const capabilities = getMongoCapabilities();
  const transactionsUnsupported =
    capabilities.transactions === TRANSACTION_SUPPORT.UNSUPPORTED;
  
  let redisStatus = "disconnected";
  let redisClient;
  try {
    redisClient = createRedisClient({
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
      retryStrategy: null,
    });

    redisClient.on("error", () => {});
    await redisClient.connect();
    await redisClient.ping();
    redisStatus = "connected";
  } catch (err) {
    redisStatus = "error";
  } finally {
    redisClient?.disconnect();
  }

  let queueStatus = "unknown";
  try {
    const counts = await backgroundQueue.getJobCounts();
    queueStatus = counts;
  } catch (err) {
    queueStatus = "error";
  }

  res.json({
    status:
      mongoStatus === "connected" &&
      redisStatus === "connected" &&
      !transactionsUnsupported
        ? "ok"
        : "degraded",
    environment: process.env.NODE_ENV,
    version: "2.0.0",
    uptime: process.uptime(),
    memoryUsage: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
    },
    system: {
      loadavg: os.loadavg(),
      freeMem: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
    },
    services: {
      mongoDB: mongoStatus,
      redis: redisStatus,
      bullMQ: queueStatus,
    },
    database: {
      state: mongoReadyState,
      label: mongoStatus,
      transactions: capabilities.transactions,
    },
  });
});

/**
 * Readiness answers "can this process serve traffic", which a connected database
 * does satisfy: every path that does not need a transaction remains usable on a
 * standalone deployment, and returning 503 here would take those paths down and
 * would stall the worker's own startup dependency.
 *
 * The capability is reported alongside it so that "ready" is never mistaken for
 * "able to run every transaction-backed operation".
 */
router.get("/ready", (req, res) => {
  const isReady = mongoose.connection.readyState === 1;
  const { transactions } = getMongoCapabilities();

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "not_ready",
    database: { transactions },
  });
});

export default router;
