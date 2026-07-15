import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import logger from "../utils/logger.js";

const API_BASE = "http://localhost:3001/api/v1";

const runSmokeTests = async () => {
  logger.info("💨 Running AthenaeumAI Smoke Test Suite...");

  // 1. Test Database Connectivity
  logger.info("⚙️  Checking MongoDB connection...");
  const conn = await connectDB();
  if (!conn) {
    logger.error("❌ MongoDB connection FAILED.");
    process.exit(1);
  }
  logger.info("✅ MongoDB connection SUCCESS.");
  await mongoose.connection.close();

  // 2. Check Health Endpoints
  logger.info("🏥 Checking backend health endpoint...");
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.status !== 200) {
      throw new Error(`Health returned status code: ${res.status}`);
    }
    const data = await res.json();
    if (data.status !== "ok" || data.database?.label !== "connected") {
      throw new Error(`Unexpected health payload: ${JSON.stringify(data)}`);
    }
    logger.info("✅ Health endpoint check SUCCESS.");
  } catch (err) {
    logger.error(`❌ Health endpoint check FAILED: ${err.message}`);
    process.exit(1);
  }

  // 3. Check Authentication endpoint
  logger.info("👤 Checking login endpoint with demo user...");
  let token = "";
  try {
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "demo@athenaeum.ai",
        password: "demopassword123",
      }),
    });
    if (loginRes.status !== 200) {
      throw new Error(`Login status returned: ${loginRes.status}`);
    }
    const data = await loginRes.json();
    if (!data.token) {
      throw new Error("Login response did not contain a token.");
    }
    token = data.token;
    logger.info("✅ Login check SUCCESS.");
  } catch (err) {
    logger.error(`❌ Login check FAILED: ${err.message}`);
    process.exit(1);
  }

  // 4. Check Protected Route with Token
  logger.info("🔒 Checking protected route access (quiz history)...");
  try {
    const historyRes = await fetch(`${API_BASE}/quiz/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (historyRes.status !== 200) {
      throw new Error(`Quiz history status returned: ${historyRes.status}`);
    }
    logger.info("✅ Protected route check SUCCESS.");
  } catch (err) {
    logger.error(`❌ Protected route check FAILED: ${err.message}`);
    process.exit(1);
  }

  logger.info("🎉 All smoke tests passed successfully!");
  process.exit(0);
};

runSmokeTests();
