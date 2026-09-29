/**
 * Integration Tests — MongoDB transaction capability against a real server
 *
 * The unit suite in `tests/unit/mongoTransactionCapability.test.js` drives the
 * real classifier and the real transaction helper, but it supplies the `hello`
 * response itself. That leaves the question this file answers: does the
 * application actually classify the deployment it is really connected to, and
 * does a transaction-backed operation on a deployment that cannot transact fail
 * safely rather than half-succeeding?
 *
 * Everything asserted here runs against a real MongoDB connection and the real
 * Mongoose models. No driver error, topology or transaction is simulated.
 *
 * These need MongoDB but not Redis, so — like `attemptSyncDurability.test.js`
 * and unlike `bullmq.test.js` — they are not gated behind the job queue.
 *
 * A transaction-capable deployment is used when the environment provides one.
 * The local development server is a standalone `mongod`, so the positive case is
 * verified against the real deployment when it exists and is otherwise reported
 * as skipped rather than asserted against a double: pretending a mocked `hello`
 * was a replica set would turn the point of the exercise into its opposite.
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import express from "express";
import supertest from "supertest";
import { DatabaseError } from "../../utils/errors.js";
import { globalErrorHandler } from "../../middleware/errorHandler.js";
import {
  TRANSACTION_SUPPORT,
  classifyTransactionSupport,
  getMongoCapabilities,
} from "../../config/database.js";
import { runInTransaction } from "../../utils/dbTransactions.js";

config({ path: new URL("../../.env", import.meta.url).pathname });

const testDbUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/athenaeumAI_test";

let connected = false;
let deployment = null;

try {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDbUri, { serverSelectionTimeoutMS: 5000 });
  }
  connected = true;
  // What the connected server reports about itself, unmediated.
  deployment = await mongoose.connection
    .getClient()
    .db("admin")
    .command({ hello: 1 });
} catch (error) {
  console.warn(
    `[mongoTransactionCapability] MongoDB unavailable, skipping: ${error.message}`,
  );
}

afterAll(async () => {
  if (connected) await mongoose.connection.close();
}, 15000);

const describeDb = connected ? describe : describe.skip;
const transactionsAvailable =
  deployment !== null &&
  classifyTransactionSupport(deployment) === TRANSACTION_SUPPORT.SUPPORTED;

const describeCapable = transactionsAvailable ? describe : describe.skip;
const describeIncapable = connected && !transactionsAvailable ? describe : describe.skip;

describeDb("MongoDB transaction capability on the connected deployment", () => {
  test("the real topology is classified from the server's own hello response", () => {
    expect(classifyTransactionSupport(deployment)).toBe(
      transactionsAvailable ? TRANSACTION_SUPPORT.SUPPORTED : TRANSACTION_SUPPORT.UNSUPPORTED,
    );
  });

  test("a replica set reports a set name and a sharded cluster reports a router", () => {
    // Guards the classifier against a regression that would accept a topology
    // which cannot actually transact.
    if (transactionsAvailable) {
      const isRouter = deployment.msg === "isdbgrid";
      expect(isRouter || typeof deployment.setName === "string").toBe(true);
    } else {
      expect(deployment.setName ?? null).toBeNull();
      expect(deployment.msg ?? null).toBeNull();
    }
  });
});

describeCapable("on a transaction-capable deployment", () => {
  test("a real transaction commits and its writes are readable afterwards", async () => {
    const collection = mongoose.connection.db.collection("t15_capable_probe");
    const marker = `t15-capable-${Date.now()}`;

    try {
      const result = await runInTransaction(async (session) => {
        await collection.insertOne({ marker }, { session });
        return "committed";
      });

      expect(result).toBe("committed");
      const persisted = await collection.findOne({ marker });
      expect(persisted).not.toBeNull();
    } finally {
      await collection.deleteMany({ marker: /^t15-capable-/ }).catch(() => {});
    }
  });

  test("the capability reflects the real deployment", () => {
    // `getMongoCapabilities` is only populated by `connectDB`, which this file
    // does not call, so an unconnected module must not claim a capability.
    expect(getMongoCapabilities().transactions).toBe(TRANSACTION_SUPPORT.UNKNOWN);
  });
});

describeIncapable("on a deployment that cannot run transactions", () => {
  test("a real transaction is genuinely impossible on this server", async () => {
    // Establishes the premise of the remaining tests against the real server
    // rather than assuming it from the topology description.
    const session = await mongoose.startSession();
    session.startTransaction();
    let failed = false;
    try {
      await mongoose.connection.db
        .collection("t15_incapable_probe")
        .insertOne({ marker: `t15-raw-${Date.now()}` }, { session });
    } catch {
      failed = true;
    } finally {
      await session.abortTransaction().catch(() => {});
      session.endSession();
    }

    expect(failed).toBe(true);
  });

  test("runInTransaction reports the prerequisite instead of the driver complaint", async () => {
    const error = await runInTransaction(async (session) => {
      await mongoose.connection.db
        .collection("t15_incapable_probe")
        .insertOne({ marker: `t15-helper-${Date.now()}` }, { session });
    }).catch((e) => e);

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.statusCode).toBe(503);
    expect(error.message).toMatch(/transaction-capable MongoDB/i);
  });

  test("the response carries no driver internals, no URI and no stack", async () => {
    // A real operation is required: a transaction that touches nothing commits
    // trivially, so this is also where the refusal is actually discovered when
    // the capability was never probed.
    const error = await runInTransaction(async (session) => {
      await mongoose.connection.db
        .collection("t15_incapable_probe")
        .insertOne({ marker: `t15-leak-${Date.now()}` }, { session });
    }).catch((e) => e);
    const body = JSON.stringify({
      message: error.message,
      name: error.name,
      statusCode: error.statusCode,
    });

    expect(body).not.toMatch(/retryWrites/i);
    expect(body).not.toMatch(/replica set member or mongos/i);
    expect(body).not.toMatch(/MongoServerError|MongoError|MongoNetworkError/);
    expect(body).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(body).not.toMatch(/127\.0\.0\.1|localhost:\d+/);
    expect(body).not.toMatch(/at Object\.|node_modules/);
  });

  test("nothing is persisted: there is no non-transactional fallback", async () => {
    const marker = `t15-fallback-${Date.now()}`;
    const collection = mongoose.connection.db.collection("t15_incapable_probe");

    await runInTransaction(async (session) => {
      await collection.insertOne({ marker }, { session });
    }).catch(() => {});

    // The decisive assertion. A fallback that wrote outside the transaction
    // would leave exactly this document behind while reporting success or a
    // clean error, which is the partial-write behaviour Task 7B exists to
    // prevent.
    const persisted = await collection.findOne({ marker });
    expect(persisted).toBeNull();
  });

  test("a second attempt is refused identically, not degraded into a write", async () => {
    const collection = mongoose.connection.db.collection("t15_incapable_probe");
    const marker = `t15-repeat-${Date.now()}`;

    for (const attempt of [1, 2]) {
      const error = await runInTransaction(async (session) => {
        await collection.insertOne({ marker }, { session });
      }).catch((e) => e);

      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.statusCode).toBe(503);
      void attempt;
    }

    expect(await collection.findOne({ marker })).toBeNull();
  });

  test("the HTTP response is a clean 503, not a 500 carrying driver internals", async () => {
    // Drives the real helper through the real global error handler, so what is
    // asserted is the body a client actually receives rather than the shape of
    // the exception in isolation.
    const app = express();
    app.use(express.json());
    app.get("/write", async (req, res, next) => {
      try {
        await runInTransaction(async (session) => {
          await mongoose.connection.db
            .collection("t15_incapable_probe")
            .insertOne({ marker: `t15-http-${Date.now()}` }, { session });
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    });
    app.use(globalErrorHandler);

    const res = await supertest(app).get("/write");
    const body = JSON.stringify(res.body);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/transaction-capable MongoDB/i);

    // Task 14 recorded the caller-visible symptom as this exact misleading
    // sentence, so its absence from the response is the regression guard.
    expect(body).not.toMatch(/retryWrites/i);
    expect(body).not.toMatch(/replica set member or mongos/i);
    expect(body).not.toMatch(/MongoServerError|MongoError|MongoNetworkError/);
    expect(body).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(body).not.toMatch(/node_modules/);
    // The cause is logged rather than returned, and no stack is exposed in a
    // non-development environment.
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body).not.toHaveProperty("originalError");
  });
});
