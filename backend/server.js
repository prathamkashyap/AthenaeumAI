import "./config/env.js"; // Validate env first before importing other packages
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import mongoose from "mongoose";
import connectDB from "./config/database.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import flashcardRoutes from "./routes/flashcardRoutes.js";
import libraryRoutes from "./routes/libraryRoutes.js";
import quizRoutes from "./routes/quizRoutes.js";
import recommendationRoutes from "./routes/recommendationRoutes.js";
import reviewQueueRoutes from "./routes/reviewQueueRoutes.js";
import tutorRoutes from "./routes/tutorRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import logger from "./utils/logger.js";
import env from "./config/env.js";
import { globalErrorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

global.__startedAt    = new Date();
global.__requestCount = 0;

// ─── Database ─────────────────────────────────────────────────────────────────

await connectDB().catch((err) => {
  logger.error("Failed to connect to database during startup:", err);
  process.exit(1);
});

// ─── Security Headers (Helmet) ────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", "data:", "blob:"],
        connectSrc:  ["'self'"],
        fontSrc:     ["'self'"],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Allow PDF/file serving
    hsts: env.NODE_ENV === "production"
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })
);

// ─── Compression ──────────────────────────────────────────────────────────────

app.use(compression());

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = env.NODE_ENV === "production"
  ? (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:8080", "http://localhost:3000", "http://127.0.0.1:8080"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin || allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods:          ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders:   ["Content-Type", "Authorization", "X-Request-Id"],
    credentials:      true,
    maxAge:           86400,
  })
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

// ─── Rate Limiters ────────────────────────────────────────────────────────────

/** General API limiter — 200 req / 15 min per IP */
const generalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              200,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests, please try again later." },
  skip:             (req) => req.path.startsWith("/api/v1/health"),
});

/** Auth limiter — 20 attempts / 15 min per IP (brute-force protection) */
const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              20,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many authentication attempts, please try again later." },
  skipSuccessfulRequests: true,
});

/** AI generation limiter — 30 req / 10 min per IP */
const aiLimiter = rateLimit({
  windowMs:         10 * 60 * 1000,
  max:              30,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "AI generation rate limit reached. Please wait before generating more." },
});

app.use(generalLimiter);

// ─── Request Correlation ID ───────────────────────────────────────────────────

app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || uuidv4();
  res.setHeader("x-request-id", req.requestId);
  next();
});

// ─── Request Counter ──────────────────────────────────────────────────────────

app.use((req, res, next) => {
  global.__requestCount++;
  next();
});

// ─── HTTP Request Logging ─────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level    = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level](`HTTP ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`, {
      requestId:  req.requestId,
      userId:     req.user?._id,
      route:      req.originalUrl,
      method:     req.method,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  next();
});

// ─── Versioned Routes ─────────────────────────────────────────────────────────

const swaggerDocument = YAML.load(path.join(__dirname, "openapi.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use("/api/v1/auth",            authLimiter, authRoutes);
app.use("/api/v1/quiz",            quizRoutes);
app.use("/api/v1/quiz/generate",   aiLimiter);
app.use("/api/v1/library",         libraryRoutes);
app.use("/api/v1/flashcards",      flashcardRoutes);
app.use("/api/v1/analytics",       analyticsRoutes);
app.use("/api/v1/recommendations", recommendationRoutes);
app.use("/api/v1/review-queue",    reviewQueueRoutes);
app.use("/api/v1/tutor",           aiLimiter, tutorRoutes);
app.use("/api/v1/health",          healthRoutes);
app.use("/api/v1/notifications",   notificationRoutes);

// Only API V1 is supported now

// ─── Root ─────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    status:  "running",
    name:    "AthenaeumAI Backend",
    version: "2.0.0",
    endpoints: [
      "POST /api/v1/auth/signup",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/refresh",
      "POST /api/v1/auth/logout",
      "POST /api/v1/quiz/generate",
      "GET  /api/v1/quiz/history",
      "GET  /api/v1/library",
      "GET  /api/v1/analytics/dashboard",
      "GET  /api/v1/recommendations/dashboard",
      "GET  /api/v1/review-queue",
      "POST /api/v1/tutor/ask",
      "POST /api/v1/tutor/ask/stream",
      "GET  /api/v1/health",
      "GET  /api/v1/health/ready",
      "GET  /api/v1/flashcards",
    ],
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Centralized Error Handling Middleware
app.use(globalErrorHandler);

// ─── Server Start ─────────────────────────────────────────────────────────────

const PORT   = env.PORT;
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  server.close(async () => {
    logger.info("HTTP server closed. Draining database connections...");
    try {
      await mongoose.connection.close();
      logger.info("Database connections closed. Shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error("Error during shutdown:", { error: err.message });
      process.exit(1);
    }
  });
  setTimeout(() => {
    logger.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
