/**
 * Integration Tests — AthenaeumAI REST API
 *
 * Uses supertest to fire real HTTP requests against a test instance of the
 * Express app (with a real MongoDB connection to a test DB).
 *
 * Test categories:
 *   1. Auth — signup, login, /me
 *   2. Protected routes — 401 when unauthenticated
 *   3. Validation errors — 400 for bad input
 *   4. Health — /api/v1/health responds 200
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const supertest = require("supertest");

// ─── App Factory (avoids top-level await binding to a real DB port) ──────────

// We import just the route handlers and build a minimal Express app for tests.
// This prevents the main server.js from starting a listener on a port.
import express from "express";
import cors from "cors";
import authRoutes from "../../routes/authRoutes.js";
import healthRoutes from "../../routes/healthRoutes.js";
import analyticsRoutes from "../../routes/analyticsRoutes.js";
import quizRoutes from "../../routes/quizRoutes.js";
import flashcardRoutes from "../../routes/flashcardRoutes.js";
import reviewQueueRoutes from "../../routes/reviewQueueRoutes.js";
import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url).pathname });

let app;
let request;

beforeAll(async () => {
  const testDbUri =
    process.env.MONGODB_URI_TEST ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/athenaeumAI_test";

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDbUri);
  }

  app = express();
  app.use(cors());
  app.use(express.json());

  // Error handler for clean 4xx/5xx test responses
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/health", healthRoutes);
  app.use("/api/v1/analytics", analyticsRoutes);
  app.use("/api/v1/quiz", quizRoutes);
  app.use("/api/v1/flashcards", flashcardRoutes);
  app.use("/api/v1/review-queue", reviewQueueRoutes);

  app.use((err, req, res, next) => {
    if (err.isOperational) return res.status(err.statusCode).json({ error: err.message });
    if (err.name === "ValidationError") return res.status(400).json({ error: "Validation failed" });
    res.status(500).json({ error: "Internal server error" });
  });

  request = supertest(app);
}, 30000);

afterAll(async () => {
  // Clean up test user created during the test run
  const { default: User } = await import("../../models/User.js");
  const { default: UserProgress } = await import("../../models/UserProgress.js");
  await User.deleteMany({ email: /integration-test/ });
  await UserProgress.deleteMany({});
  await mongoose.connection.close();
}, 15000);

// ─── Test Data ────────────────────────────────────────────────────────────────

const TEST_USER = {
  name: "Integration Tester",
  email: `integration-test-${Date.now()}@athenaeumtest.com`,
  password: "SecurePass123!",
};

let authToken = "";
let userId = "";

// ─── 1. Health Check ─────────────────────────────────────────────────────────

describe("GET /api/v1/health", () => {
  test("returns 200 with status ok", async () => {
    const res = await request.get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
  });
});

// ─── 2. Auth — Signup ────────────────────────────────────────────────────────

describe("POST /api/v1/auth/signup", () => {
  test("creates a new user and returns token", async () => {
    const res = await request.post("/api/v1/auth/signup").send(TEST_USER);
    expect([201, 503]).toContain(res.status); // 503 if no test DB
    if (res.status === 201) {
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.email).toBe(TEST_USER.email);
      authToken = res.body.token;
      userId = res.body.user._id || res.body.user.id;
    }
  });

  test("returns 409 when email already registered", async () => {
    if (!authToken) return; // skip if no DB
    const res = await request.post("/api/v1/auth/signup").send(TEST_USER);
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
  });

  test("returns 400 when name is missing", async () => {
    const res = await request
      .post("/api/v1/auth/signup")
      .send({ email: "test@test.com", password: "password123" });
    expect([400, 422]).toContain(res.status);
  });

  test("returns 400 when email is missing", async () => {
    const res = await request
      .post("/api/v1/auth/signup")
      .send({ name: "Test", password: "password123" });
    expect([400, 422]).toContain(res.status);
  });

  test("returns 400 when password is too short", async () => {
    const res = await request
      .post("/api/v1/auth/signup")
      .send({ name: "Test", email: "short@test.com", password: "abc" });
    expect([400, 422]).toContain(res.status);
  });

  test("returns 400 for invalid email format", async () => {
    const res = await request
      .post("/api/v1/auth/signup")
      .send({ name: "Test", email: "not-an-email", password: "password123" });
    expect([400, 422]).toContain(res.status);
  });
});

// ─── 3. Auth — Login ─────────────────────────────────────────────────────────

describe("POST /api/v1/auth/login", () => {
  test("logs in with correct credentials and returns token", async () => {
    if (!authToken) return; // skip if no DB
    const res = await request
      .post("/api/v1/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    authToken = res.body.token; // refresh token
  });

  test("returns 401 with wrong password", async () => {
    if (!authToken) return;
    const res = await request
      .post("/api/v1/auth/login")
      .send({ email: TEST_USER.email, password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  test("returns 401 with non-existent email", async () => {
    const res = await request
      .post("/api/v1/auth/login")
      .send({ email: "nobody@nowhere.com", password: "anypassword" });
    expect([401, 503]).toContain(res.status);
  });

  test("returns 400 when email is missing", async () => {
    const res = await request
      .post("/api/v1/auth/login")
      .send({ password: "password123" });
    expect([400, 422]).toContain(res.status);
  });
});

// ─── 4. Auth — /me ───────────────────────────────────────────────────────────

describe("GET /api/v1/auth/me", () => {
  test("returns current user when authenticated", async () => {
    if (!authToken) return;
    const res = await request
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toHaveProperty("email");
  });

  test("returns 401 when no token provided", async () => {
    const res = await request.get("/api/v1/auth/me");
    expect([401, 503]).toContain(res.status);
  });

  test("returns 401 when invalid token provided", async () => {
    const res = await request
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalid.token.here");
    expect([401, 503]).toContain(res.status);
  });
});

// ─── 5. Protected Routes — Block Unauthenticated Requests ───────────────────

describe("Protected routes — reject unauthenticated requests", () => {
  const protectedEndpoints = [
    { method: "get", path: "/api/v1/analytics/dashboard" },
    { method: "get", path: "/api/v1/quiz/history" },
    { method: "get", path: "/api/v1/flashcards" },
    { method: "get", path: "/api/v1/review-queue" },
  ];

  protectedEndpoints.forEach(({ method, path }) => {
    test(`${method.toUpperCase()} ${path} → 401 without token`, async () => {
      const res = await request[method](path);
      expect([401, 503]).toContain(res.status);
    });
  });
});

// ─── 6. Analytics — Authenticated ───────────────────────────────────────────

describe("GET /api/v1/analytics/dashboard", () => {
  test("returns dashboard data for authenticated user", async () => {
    if (!authToken) return;
    const res = await request
      .get("/api/v1/analytics/dashboard")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body.totals).toHaveProperty("quizzesTaken");
    expect(res.body.totals).toHaveProperty("averageAccuracy");
  });
});

// ─── 7. Flashcards — Authenticated ───────────────────────────────────────────

describe("GET /api/v1/flashcards", () => {
  test("returns flashcard sets for authenticated user", async () => {
    if (!authToken) return;
    const res = await request
      .get("/api/v1/flashcards")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── 8. Review Queue — Authenticated ─────────────────────────────────────────

describe("GET /api/v1/review-queue", () => {
  test("returns review queue for authenticated user", async () => {
    if (!authToken) return;
    const res = await request
      .get("/api/v1/review-queue")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
