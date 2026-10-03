/**
 * The single place Redis connections are constructed.
 *
 * Three call sites need a Redis client — the queue in `utils/jobQueue.js`, the
 * worker in `worker.js`, and the probe in `routes/healthRoutes.js` — and they
 * must all agree on where Redis is. They previously did not: `REDIS_URL` support
 * was added to the queue alone, so on Render the queue reached managed Redis
 * while the worker and the health probe silently fell back to `localhost:6379`
 * and failed with `ECONNREFUSED`.
 *
 * Resolution order:
 *
 *   1. `REDIS_URL` — a connection string, which is what managed providers hand
 *      out (Render Key Value, Atlas, Upstash, Railway). Both ioredis and BullMQ
 *      accept one directly.
 *   2. `REDIS_HOST` / `REDIS_PORT` — what Docker Compose and local development
 *      use, where Redis is addressed by host and port.
 *
 * `REDIS_URL` deliberately wins: on a managed platform it is the only value that
 * is set, and silently preferring a localhost default there produces a
 * connection failure that looks like a network problem rather than a
 * misconfiguration.
 */

import Redis from "ioredis";

/**
 * @param {object} [options] ioredis options for this particular client. Passed
 *   through untouched in both branches, so per-site tuning (timeouts, retry
 *   strategy, `lazyConnect`) stays at the call site.
 * @returns {import("ioredis").Redis}
 */
export const createRedisClient = (options = {}) =>
  process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, options)
    : new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT) || 6379,
        ...options,
      });

export default createRedisClient;
