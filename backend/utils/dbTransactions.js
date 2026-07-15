import mongoose from "mongoose";
import logger from "./logger.js";

/**
 * Runs a block of operations within a MongoDB transaction.
 * @param {Function} callback - An async function that receives the `session` object.
 * @returns The result of the callback function.
 */
export const runInTransaction = async (callback) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    logger.warn("Transaction failed, aborting...", { error: error.message });
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
