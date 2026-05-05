import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import connectDB from "./config/database.js";
import quizRoutes from "./routes/quizRoutes.js";
import { seedDefaultQuizzes } from "./services/defaultQuizSeeder.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Connect to MongoDB
const dbConnection = await connectDB();

// Rate limiting — 5 quiz generations per minute
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many requests. Please wait a minute before generating another quiz." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limit only to generation endpoint
app.use("/api/quiz/generate", generateLimiter);

// Routes
app.use("/api/quiz", quizRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "running",
    name: "AthenaeumAI Backend",
    endpoints: [
      "POST /api/quiz/generate",
      "GET  /api/quiz/history",
      "GET  /api/quiz/subjects",
      "GET  /api/quiz/subject/:subject",
      "GET  /api/quiz/:id",
      "POST /api/quiz/:id/attempt",
    ],
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum size is 10MB." });
  }

  if (err.message?.includes("Only PDF")) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: err.message || "Something went wrong" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`\n🚀 AthenaeumAI Backend running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);

  // Seed default quizzes if DB is connected
  if (dbConnection) {
    const studyMaterialPath = path.join(__dirname, "..", "study material");
    // Run seeding in background — don't block server startup
    seedDefaultQuizzes(studyMaterialPath).catch((err) => {
      console.error("Seeding error:", err.message);
    });
  }
});