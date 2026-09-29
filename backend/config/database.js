import mongoose from "mongoose";
import logger from "../utils/logger.js";

let isConnected = false;

/**
 * The three answers to "can this deployment run multi-document transactions?".
 *
 * `UNKNOWN` is a genuine answer rather than a placeholder: it means the probe
 * could not be completed, so the application must neither claim the capability
 * nor deny it. Treating unknown as unsupported would take every transaction path
 * down because of a transient probe failure.
 */
export const TRANSACTION_SUPPORT = {
  SUPPORTED: "supported",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown",
};

let transactionSupport = TRANSACTION_SUPPORT.UNKNOWN;

/**
 * Decides whether a `hello` response describes a topology able to run
 * multi-document transactions.
 *
 * Transactions require a replica set or a sharded cluster. A replica set member
 * reports `setName`; a mongos router reports `msg: "isdbgrid"`. A standalone
 * server reports neither.
 *
 * This is read from the server actually connected to, never inferred from the
 * connection string: a URI may carry `?replicaSet=rs0` while the server behind
 * it is a standalone, which is exactly the deployment that Task 14 hit.
 */
export const classifyTransactionSupport = (hello) => {
  if (!hello || typeof hello !== "object") return TRANSACTION_SUPPORT.UNKNOWN;

  if (hello.msg === "isdbgrid") return TRANSACTION_SUPPORT.SUPPORTED;

  if (typeof hello.setName === "string" && hello.setName.length > 0) {
    return TRANSACTION_SUPPORT.SUPPORTED;
  }

  return TRANSACTION_SUPPORT.UNSUPPORTED;
};

/**
 * Asks the connected deployment what it can do.
 *
 * A probe failure is logged and reported as unknown; it must never fail the
 * connection itself, because a database that is reachable but momentarily
 * un-probeable is still a working database for every non-transactional path.
 */
const probeTransactionSupport = async () => {
  try {
    const client = mongoose.connection.getClient();
    const hello = await client.db("admin").command({ hello: 1 });
    return classifyTransactionSupport(hello);
  } catch (err) {
    logger.warn("Could not determine MongoDB transaction support:", {
      error: err.message,
    });
    return TRANSACTION_SUPPORT.UNKNOWN;
  }
};

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/athenaeum";

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    isConnected = true;
    transactionSupport = await probeTransactionSupport();
    logger.info(`MongoDB connected: ${conn.connection.host}`);

    if (transactionSupport === TRANSACTION_SUPPORT.UNSUPPORTED) {
      logger.warn(
        "⚠️  Connected MongoDB cannot run transactions (standalone deployment). " +
          "Quiz generation and attempt sync will be rejected with a 503 until a " +
          "replica set or sharded cluster is connected. See docker-compose.yml.",
      );
    }

    return conn;
  } catch (err) {
    isConnected = false;
    transactionSupport = TRANSACTION_SUPPORT.UNKNOWN;
    logger.error("MongoDB connection error:", err);
    logger.warn("⚠️  Running without database — quizzes will not be persisted.");
    return null;
  }
};

/**
 * Check if MongoDB is connected.
 * Use this before any DB operations to avoid buffering timeouts.
 */
export const isDBConnected = () => isConnected;

/**
 * The deployment capabilities this application depends on.
 *
 * Deliberately narrow: connection state and transaction support are the only
 * two facts controllers act on today. The host list and set name are not
 * returned, so this is safe to expose over the health surface.
 */
export const getMongoCapabilities = () => ({
  connected: isConnected,
  transactions: transactionSupport,
});

export const supportsTransactions = () =>
  transactionSupport === TRANSACTION_SUPPORT.SUPPORTED;

export default connectDB;
