/**
 * Contract Tests — the health surface reports capability, not just connection
 *
 * `routes/healthRoutes.js` is the only health implementation the server mounts
 * (`server.js:183`); `controllers/healthController.js` is never imported. It
 * reports a deployment as `ok` only when MongoDB, Redis and — since Task 15 —
 * transaction capability are all present.
 *
 * Redis is mocked here deliberately. The capability decision is entangled with
 * the Redis check in the same expression, so asserting it against a real
 * environment where Redis is down cannot distinguish "the capability was
 * considered" from "the capability was ignored and Redis happened to fail".
 * Mocking the dependency isolates the decision under test and keeps this suite
 * runnable with neither Redis nor MongoDB.
 */

import { jest } from "@jest/globals";

const readyState = { value: 1 };
const capabilities = { connected: true, transactions: "unsupported" };
const redisConnect = jest.fn(async () => {});
const redisPing = jest.fn(async () => "PONG");
const getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0 }));

jest.unstable_mockModule("mongoose", () => ({
  default: {
    connection: {
      get readyState() {
        return readyState.value;
      },
    },
  },
}));

jest.unstable_mockModule("ioredis", () => ({
  default: class RedisDouble {
    on() {
      return this;
    }
    async connect() {
      return redisConnect();
    }
    async ping() {
      return redisPing();
    }
    disconnect() {}
  },
}));

jest.unstable_mockModule("../../utils/jobQueue.js", () => ({
  backgroundQueue: { getJobCounts },
}));

jest.unstable_mockModule("../../config/database.js", () => ({
  TRANSACTION_SUPPORT: { SUPPORTED: "supported", UNSUPPORTED: "unsupported", UNKNOWN: "unknown" },
  getMongoCapabilities: () => capabilities,
}));

const { default: healthRoutes } = await import("../../routes/healthRoutes.js");
const express = (await import("express")).default;
const supertest = (await import("supertest")).default;

let app;

beforeEach(async () => {
  capabilities.connected = true;
  capabilities.transactions = "unsupported";
  readyState.value = 1;
  redisConnect.mockClear();
  redisPing.mockClear();
  getJobCounts.mockClear();

  app = express();
  app.use(express.json());
  app.use("/api/v1/health", healthRoutes);
});

const health = () => supertest(app).get("/api/v1/health");
const ready = () => supertest(app).get("/api/v1/health/ready");

describe("GET /api/v1/health with every dependency present", () => {
  test("a transaction-capable deployment is not rejected", async () => {
    capabilities.transactions = "supported";
    const res = await health();

    expect(res.status).toBe(200);
    // Guards against the inverse error: refusing a replica set that is fully
    // capable would be as wrong as accepting a standalone that is not.
    expect(res.body.status).toBe("ok");
    expect(res.body.database.transactions).toBe("supported");
    expect(res.body.services.mongoDB).toBe("connected");
  });

  test("an unprobed deployment is not reported as broken", async () => {
    capabilities.transactions = "unknown";
    const res = await health();

    expect(res.body.status).toBe("ok");
    expect(res.body.database.transactions).toBe("unknown");
  });
});

describe("GET /api/v1/health when transactions are impossible", () => {
  test("a connected but incapable deployment is not reported as ok", async () => {
    const res = await health();

    // Redis is connected here, so `degraded` can only come from the capability
    // check. This is the assertion that fails if that check is dropped.
    expect(redisPing).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.mongoDB).toBe("connected");
    expect(res.body.services.redis).toBe("connected");
    expect(res.body.database.transactions).toBe("unsupported");
  });

  test("the capability is reported without describing the topology", async () => {
    const res = await health();
    const body = JSON.stringify(res.body);

    expect(body).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(body).not.toMatch(/127\.0\.0\.1|localhost:\d+|mongodb:27017/);
    expect(body).not.toMatch(/rs0/);
  });
});

describe("GET /api/v1/health/ready", () => {
  test("a connected deployment is ready regardless of transaction capability", async () => {
    capabilities.transactions = "unsupported";
    const res = await ready();

    // Readiness answers "can serve traffic", which a connected database
    // satisfies. Returning 503 here would take every non-transactional path
    // down and would stall the worker's startup dependency.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.database.transactions).toBe("unsupported");
  });

  test("a disconnected deployment is still not ready", async () => {
    readyState.value = 0;
    const res = await ready();

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
  });
});
