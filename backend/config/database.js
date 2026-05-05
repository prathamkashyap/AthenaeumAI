import mongoose from "mongoose";

let isConnected = false;

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/athenaeum";
    
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    isConnected = false;
    console.error("MongoDB connection error:", err.message);
    console.warn("⚠️  Running without database — quizzes will not be persisted.");
    return null;
  }
};

/**
 * Check if MongoDB is connected.
 * Use this before any DB operations to avoid buffering timeouts.
 */
export const isDBConnected = () => isConnected;

export default connectDB;
