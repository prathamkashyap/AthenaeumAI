import mongoose from "mongoose";
import logger from "../utils/logger.js";

let isConnected = false;

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/athenaeum";
    
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    isConnected = true;
    logger.info(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    isConnected = false;
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

export default connectDB;
