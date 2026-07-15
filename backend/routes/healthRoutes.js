import express from "express";
import mongoose from "mongoose";
import Redis from "ioredis";
import { backgroundQueue } from "../utils/jobQueue.js";
import os from "os";
import process from "process";

const router = express.Router();

router.get("/", async (req, res) => {
  const mongoReadyState = mongoose.connection.readyState;
  const mongoStatus = mongoReadyState === 1 ? "connected" : "disconnected";
  
  let redisStatus = "disconnected";
  let redisClient;
  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT) || 6379,
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
    status: mongoStatus === "connected" && redisStatus === "connected" ? "ok" : "degraded",
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
    },
  });
});

router.get("/ready", (req, res) => {
  const isReady = mongoose.connection.readyState === 1;
  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "not_ready",
  });
});

export default router;
