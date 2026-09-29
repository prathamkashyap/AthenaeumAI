/**
 * Contract Tests — MongoDB transaction capability
 *
 * Quiz generation (`quizController.js:134`) and attempt sync (`worker.js:73`)
 * both persist through `runInTransaction`, and both treat the transaction as
 * mandatory: the callback's writes must commit together or not at all. That is
 * only meaningful on a replica set or sharded cluster, so a standalone mongod
 * cannot serve those operations no matter how the connection was configured.
 *
 * Before this suite the application asked only "is a socket open". Reaching a
 * transaction on a standalone deployment surfaced the driver's own complaint —
 * "This MongoDB deployment does not support retryable writes. Please add
 * retryWrites=false to your connection string" — which is not merely unhelpful
 * but wrong, because that option does not make a standalone mongod able to
 * transact. A caller who followed the advice still had a broken deployment.
 *
 * The contract asserted here is that the answer comes from the connected
 * deployment, that a transaction-backed operation is refused with an
 * application-level error when the prerequisite is known to be missing, and
 * that no non-transactional path is taken to make the failure disappear.
 *
 * The capability probe and the transaction helper are the real code. Only
 * Mongoose and the logger are replaced.
 */

import { jest } from "@jest/globals";
import { DatabaseError } from "../../utils/errors.js";

// ─── Infrastructure doubles ───────────────────────────────────────────────────

const startSession = jest.fn();
const connectionHost = "127.0.0.1";
const connectionDb = {
  admin: () => ({ command: jest.fn() }),
};
const readyState = { value: 1 };

jest.unstable_mockModule("mongoose", () => {
  const connection = {
    get readyState() {
      return readyState.value;
    },
    get host() {
      return connectionHost;
    },
    getClient: () => ({ db: () => connectionDb.admin() }),
  };
  return {
    default: {
      connect: jest.fn(async () => ({ connection })),
      connection,
      // The helper calls `mongoose.startSession()` on the default export.
      startSession,
    },
    startSession,
  };
});

jest.unstable_mockModule("../../utils/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const {
  TRANSACTION_SUPPORT,
  classifyTransactionSupport,
  getMongoCapabilities,
  isDBConnected,
  supportsTransactions,
} = await import("../../config/database.js");

const { default: connectDB } = await import("../../config/database.js");

const {
  runInTransaction,
  isTransactionCapabilityError,
  TRANSACTION_PREREQUISITE_MESSAGE,
} = await import("../../utils/dbTransactions.js");

/** The driver's exact complaint, as observed against a real standalone mongod. */
const DRIVER_STANDALONE_ERROR =
  "This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.";

const mockSession = () => ({
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(async () => {}),
  abortTransaction: jest.fn(async () => {}),
  endSession: jest.fn(),
});

const helloCommand = jest.fn();
let session;

/** Drives `connectDB` against a deployment that reports the given `hello`. */
const connectTo = async (hello) => {
  helloCommand.mockReset();
  helloCommand.mockResolvedValue(hello);
  connectionDb.admin = () => ({ command: helloCommand });
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/athenaeumAI_test";
  readyState.value = 1;
  await connectDB();
};

beforeEach(() => {
  startSession.mockReset();
  session = mockSession();
  startSession.mockResolvedValue(session);
  helloCommand.mockReset();
  readyState.value = 1;
});

// ─── The answer comes from the deployment, not the connection string ──────────

describe("classifyTransactionSupport", () => {
  test("a replica set member is transaction-capable", () => {
    expect(classifyTransactionSupport({ setName: "rs0", isWritablePrimary: true }))
      .toBe(TRANSACTION_SUPPORT.SUPPORTED);
  });

  test("a sharded cluster router is transaction-capable", () => {
    expect(classifyTransactionSupport({ msg: "isdbgrid" }))
      .toBe(TRANSACTION_SUPPORT.SUPPORTED);
  });

  test("a standalone server is not", () => {
    expect(
      classifyTransactionSupport({
        isWritablePrimary: true,
        logicalSessionTimeoutMinutes: 30,
        hosts: null,
        setName: null,
        msg: null,
      })
    ).toBe(TRANSACTION_SUPPORT.UNSUPPORTED);
  });

  test("an empty set name is not a replica set", () => {
    expect(classifyTransactionSupport({ setName: "" }))
      .toBe(TRANSACTION_SUPPORT.UNSUPPORTED);
  });

  test("a response that is not a topology report is unknown, not unsupported", () => {
    // Reporting "unsupported" here would disable every transaction path on a
    // transient probe problem, so the distinction has to be load-bearing.
    expect(classifyTransactionSupport(null)).toBe(TRANSACTION_SUPPORT.UNKNOWN);
    expect(classifyTransactionSupport(undefined)).toBe(TRANSACTION_SUPPORT.UNKNOWN);
    expect(classifyTransactionSupport("isdbgrid")).toBe(TRANSACTION_SUPPORT.UNKNOWN);
  });
});

describe("capability detection at connection time", () => {
  test("records a replica set as transaction-capable", async () => {
    await connectTo({ setName: "rs0" });

    expect(getMongoCapabilities()).toEqual({
      connected: true,
      transactions: TRANSACTION_SUPPORT.SUPPORTED,
    });
    expect(supportsTransactions()).toBe(true);
  });

  test("records a standalone deployment as incapable", async () => {
    await connectTo({ isWritablePrimary: true, setName: null, msg: null });

    expect(getMongoCapabilities().transactions).toBe(TRANSACTION_SUPPORT.UNSUPPORTED);
    expect(supportsTransactions()).toBe(false);
    // Connection state is unchanged: being connected is still true, which is
    // exactly why the two facts are reported separately.
    expect(isDBConnected()).toBe(true);
  });

  test("a probe failure keeps the connection and reports unknown", async () => {
    helloCommand.mockRejectedValue(new Error("not authorized on admin"));
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/athenaeumAI_test";
    await connectDB();

    expect(isDBConnected()).toBe(true);
    expect(getMongoCapabilities().transactions).toBe(TRANSACTION_SUPPORT.UNKNOWN);
  });

  test("a failed connection reports neither connected nor capable", async () => {
    const mongoose = (await import("mongoose")).default;
    mongoose.connect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await connectDB();

    expect(isDBConnected()).toBe(false);
    expect(getMongoCapabilities().transactions).toBe(TRANSACTION_SUPPORT.UNKNOWN);
  });
});

// ─── A known-incapable deployment is refused before any write happens ─────────

describe("runInTransaction against a deployment that cannot transact", () => {
  test("refuses without opening a session, and never calls the callback", async () => {
    await connectTo({ setName: null, msg: null });
    const callback = jest.fn();

    await expect(runInTransaction(callback)).rejects.toThrow(TRANSACTION_PREREQUISITE_MESSAGE);

    // The check has to precede session creation: opening a session and then
    // failing would still let a caller believe the transaction was attempted.
    expect(startSession).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(session.startTransaction).not.toHaveBeenCalled();
  });

  test("surfaces an application error, not a driver error", async () => {
    await connectTo({ setName: null, msg: null });

    const error = await runInTransaction(async () => {}).catch((e) => e);

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.statusCode).toBe(503);
    // Nothing was attempted, so there is no underlying driver error to carry.
    expect(error.originalError).toBeNull();
  });

  test("the message never leaks driver internals or wrong advice", async () => {
    await connectTo({ setName: null, msg: null });

    const error = await runInTransaction(async () => {}).catch((e) => e);
    const body = JSON.stringify({
      message: error.message,
      name: error.name,
      statusCode: error.statusCode,
    });

    // retryWrites is the driver's suggestion and it does not work here.
    expect(body).not.toMatch(/retryWrites/i);
    expect(body).not.toMatch(/replica set member or mongos/i);
    expect(body).not.toMatch(/mongodb:\/\//i);
    expect(body).not.toMatch(/MongoServerError|MongoError|MongoServerSelectionError/);
  });
});

// ─── An unprobed deployment keeps working, and is still mapped if it lies ─────

describe("runInTransaction when capability is not yet known", () => {
  test("proceeds, so an inconclusive probe cannot disable transactions", async () => {
    await connectTo(null);
    expect(getMongoCapabilities().transactions).toBe(TRANSACTION_SUPPORT.UNKNOWN);

    const result = await runInTransaction(async (s) => {
      expect(s).toBe(session);
      return "committed";
    });

    expect(result).toBe("committed");
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
  });

  test("maps the driver's standalone complaint to the application error", async () => {
    await connectTo(null);
    const driverError = new Error(DRIVER_STANDALONE_ERROR);
    driverError.name = "MongoServerError";

    const error = await runInTransaction(async () => {
      throw driverError;
    }).catch((e) => e);

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.message).toBe(TRANSACTION_PREREQUISITE_MESSAGE);
    expect(error.statusCode).toBe(503);
    expect(error.message).not.toMatch(/retryWrites/i);
    // The underlying cause is retained for logs, not for the response.
    expect(error.originalError).toBe(driverError);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test("also recognises the transaction-number form of the same refusal", () => {
    expect(
      isTransactionCapabilityError(
        new Error("Transaction numbers are only allowed on a replica set member or mongos")
      )
    ).toBe(true);
  });

  test("leaves unrelated database failures alone", () => {
    // Over-broad matching would report a permissions problem as a deployment
    // problem, which is the same class of misdiagnosis this task removes.
    expect(isTransactionCapabilityError(new Error("E11000 duplicate key error"))).toBe(false);
    expect(isTransactionCapabilityError(new Error("not authorized on athenaeum"))).toBe(false);
    expect(isTransactionCapabilityError(undefined)).toBe(false);
  });

  test("propagates an ordinary failure unchanged", async () => {
    await connectTo(null);
    const domainError = new Error("quiz validation failed");

    const error = await runInTransaction(async () => {
      throw domainError;
    }).catch((e) => e);

    expect(error).toBe(domainError);
    expect(error).not.toBeInstanceOf(DatabaseError);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  });
});

// ─── A capable deployment behaves exactly as before ───────────────────────────

describe("runInTransaction on a transaction-capable deployment", () => {
  test("commits the callback's result", async () => {
    await connectTo({ setName: "rs0" });

    const result = await runInTransaction(async () => ({ saved: true }));

    expect(result).toEqual({ saved: true });
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test("a capable deployment is never rejected by the gate", async () => {
    await connectTo({ msg: "isdbgrid" });

    await expect(runInTransaction(async () => "ok")).resolves.toBe("ok");
    expect(supportsTransactions()).toBe(true);
  });

  test("aborts and rethrows on failure, still ending the session", async () => {
    await connectTo({ setName: "rs0" });
    const failure = new Error("effect failed");

    await expect(
      runInTransaction(async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
