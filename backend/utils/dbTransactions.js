import mongoose from "mongoose";
import logger from "./logger.js";
import { DatabaseError } from "./errors.js";
import {
  TRANSACTION_SUPPORT,
  getMongoCapabilities,
} from "../config/database.js";

/**
 * The client-facing explanation for a deployment that cannot run transactions.
 *
 * It names the requirement and the remedy, and nothing else. In particular it
 * must not repeat the driver's own wording: on a standalone server the driver
 * reports "This MongoDB deployment does not support retryable writes. Please add
 * retryWrites=false to your connection string", which is not merely unhelpful but
 * actively wrong — `retryWrites=false` does not make a standalone mongod
 * transaction-capable, so a caller who follows that advice still gets nothing.
 */
export const TRANSACTION_PREREQUISITE_MESSAGE =
  "This operation requires transaction-capable MongoDB. The connected deployment " +
  "is a standalone server, which cannot run multi-document transactions.";

/**
 * Recognises the driver's own complaint about a topology that cannot transact.
 *
 * Kept deliberately narrow, and consulted only when the application has not
 * already established the answer. A standalone server reports this condition
 * without a machine-readable `code` or `codeName`, so the message is the only
 * available signal; matching loosely here would convert unrelated database
 * failures into a misleading deployment error.
 */
export const isTransactionCapabilityError = (error) => {
  const message = String(error?.message ?? "");
  return (
    message.includes("does not support retryable writes") ||
    message.includes("Transaction numbers are only allowed on a replica set member or mongos")
  );
};

/**
 * Runs a block of operations within a MongoDB transaction.
 *
 * The transaction is mandatory. Callers depend on the callback's writes
 * committing together or not at all — `SYNC_ATTEMPT` uses exactly that to keep
 * its durable claim and its learner effects atomic — so there is deliberately no
 * non-transactional path here, and a deployment that cannot honour the
 * transaction is reported rather than worked around.
 *
 * @param {Function} callback - An async function that receives the `session` object.
 * @returns The result of the callback function.
 */
export const runInTransaction = async (callback) => {
  // Fail before opening a session when the answer is already known. `unknown`
  // is allowed through: it means unprobed, not incapable, and blocking on it
  // would disable every transaction path whenever a probe was inconclusive.
  if (getMongoCapabilities().transactions === TRANSACTION_SUPPORT.UNSUPPORTED) {
    throw new DatabaseError(TRANSACTION_PREREQUISITE_MESSAGE);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    // A topology that was not known to be incapable can still be discovered
    // here, at the first operation inside the transaction. Report it with the
    // same application-level error instead of letting the driver's misleading
    // wording reach the client.
    if (isTransactionCapabilityError(error)) {
      try {
        await session.abortTransaction();
      } catch {
        // The transaction never started, so there is nothing to roll back.
      }
      logger.error("Transaction refused by the connected MongoDB deployment", {
        error: error.message,
      });
      throw new DatabaseError(TRANSACTION_PREREQUISITE_MESSAGE, error);
    }

    logger.warn("Transaction failed, aborting...", { error: error.message });
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
