import mongoose from "mongoose";
import logger from "../utils/logger.js";

/**
 * Database readyState labels for human-readable output.
 * @see https://mongoosejs.com/docs/api/connection.html#Connection.prototype.readyState
 */
const DB_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

/**
 * GET /api/v1/health
 * Returns comprehensive server health information including uptime,
 * memory usage, database status, and request metrics.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export const getHealth = (req, res, next) => {
  try {
    const memUsage = process.memoryUsage();
    const dbState = mongoose.connection.readyState;

    const payload = {
      status: dbState === 1 ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: "1.8.0",
      environment: process.env.NODE_ENV || "development",
      memory: {
        rss: +(memUsage.rss / 1024 / 1024).toFixed(2),
        heapUsed: +(memUsage.heapUsed / 1024 / 1024).toFixed(2),
        heapTotal: +(memUsage.heapTotal / 1024 / 1024).toFixed(2),
      },
      database: {
        state: dbState,
        label: DB_STATES[dbState] || "unknown",
      },
      requestCount: global.__requestCount || 0,
      startedAt: global.__startedAt || null,
    };

    res.status(dbState === 1 ? 200 : 503).json(payload);
  } catch (err) {
    logger.error("Health check failed", {
      requestId: req.requestId,
      error: err.message,
    });
    next(err);
  }
};

/**
 * GET /api/v1/health/ready
 * Lightweight readiness probe — returns 200 only when the database
 * connection is fully established (readyState === 1).
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export const getReadiness = (req, res, next) => {
  try {
    if (mongoose.connection.readyState === 1) {
      return res.status(200).json({ status: "ready" });
    }

    return res.status(503).json({ status: "not_ready" });
  } catch (err) {
    logger.error("Readiness check failed", {
      requestId: req.requestId,
      error: err.message,
    });
    next(err);
  }
};
