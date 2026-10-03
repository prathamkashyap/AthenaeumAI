/**
 * Contract Tests — Redis connection resolution
 *
 * Regression cover for a real production failure. `REDIS_URL` support had been
 * added to the queue alone, so on Render the queue reached managed Redis while
 * the worker and the health probe fell back to `localhost:6379` and failed with
 * `ECONNREFUSED`. These tests pin the resolution order at the single place all
 * three call sites now share, so a fourth site cannot reintroduce the split.
 *
 * ioredis is replaced with a fake that records how it was constructed.
 */

import { jest } from "@jest/globals";

const constructorCalls = [];

const RedisFake = jest.fn(function RedisFake(...args) {
  constructorCalls.push(args);
  this.options = args.length === 1 && typeof args[0] === "object" ? args[0] : args[1] ?? {};
  this.isUrlForm = typeof args[0] === "string";
});

jest.unstable_mockModule("ioredis", () => ({ default: RedisFake }));

let createRedisClient;
let originalUrl;
let originalHost;
let originalPort;

beforeEach(async () => {
  originalUrl = process.env.REDIS_URL;
  originalHost = process.env.REDIS_HOST;
  originalPort = process.env.REDIS_PORT;
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  constructorCalls.length = 0;
  RedisFake.mockClear();
  jest.resetModules();
  ({ createRedisClient } = await import("../../utils/redisConnection.js"));
});

afterEach(() => {
  for (const [key, value] of [
    ["REDIS_URL", originalUrl],
    ["REDIS_HOST", originalHost],
    ["REDIS_PORT", originalPort],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("createRedisClient", () => {
  test("uses REDIS_URL when the platform provides one", () => {
    process.env.REDIS_URL = "redis://red-abc123:6379";

    createRedisClient({ maxRetriesPerRequest: null });

    expect(constructorCalls).toHaveLength(1);
    const [first, second] = constructorCalls[0];
    expect(first).toBe("redis://red-abc123:6379");
    expect(second).toEqual({ maxRetriesPerRequest: null });
  });

  test("prefers REDIS_URL even when host and port are also set", () => {
    // A managed platform sets only REDIS_URL. If a stale REDIS_HOST were ever
    // present alongside it, honouring the URL is what keeps the worker off
    // localhost — which is the failure this module exists to prevent.
    process.env.REDIS_URL = "redis://red-managed:6379";
    process.env.REDIS_HOST = "localhost";
    process.env.REDIS_PORT = "6379";

    createRedisClient();

    expect(constructorCalls[0][0]).toBe("redis://red-managed:6379");
  });

  test("falls back to host and port for Compose and local development", () => {
    process.env.REDIS_HOST = "redis";
    process.env.REDIS_PORT = "6380";

    createRedisClient();

    expect(constructorCalls[0]).toHaveLength(1);
    expect(constructorCalls[0][0]).toEqual({ host: "redis", port: 6380 });
  });

  test("defaults to localhost:6379 when nothing is configured", () => {
    createRedisClient();

    expect(constructorCalls[0][0]).toEqual({ host: "localhost", port: 6379 });
  });

  test("passes per-site options through in both branches", () => {
    process.env.REDIS_URL = "redis://red-abc123:6379";
    createRedisClient({ lazyConnect: true, connectTimeout: 1000 });
    expect(constructorCalls[0][1]).toEqual({ lazyConnect: true, connectTimeout: 1000 });

    constructorCalls.length = 0;
    delete process.env.REDIS_URL;
    process.env.REDIS_HOST = "redis";
    createRedisClient({ lazyConnect: true, connectTimeout: 1000 });
    expect(constructorCalls[0][0]).toEqual({
      host: "redis",
      port: 6379,
      lazyConnect: true,
      connectTimeout: 1000,
    });
  });
});

describe("every production Redis client goes through the shared resolver", () => {
  /**
   * The bug was not that one site had the wrong logic — it was that three sites
   * each had their own. This asserts there is exactly one construction of a Redis
   * client in the production source, so the resolution order cannot drift apart
   * again.
   */
  test("no production module constructs a Redis client directly", async () => {
    const { readFileSync, readdirSync, statSync } = await import("fs");
    const { join } = await import("path");

    const root = new URL("../../", import.meta.url).pathname;
    const offenders = [];

    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "coverage" || entry === "logs") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".js")) continue;
        if (entry.endsWith(".test.js")) continue;

        const source = readFileSync(full, "utf8");
        if (/new Redis\s*\(/.test(source)) {
          offenders.push(full.replace(root, ""));
        }
      }
    };

    walk(root);

    expect(offenders).toEqual(["utils/redisConnection.js"]);
  });
});
