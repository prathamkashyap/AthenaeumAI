import { generateQuiz } from "../services/quizService.js";
import { extractTextFromPDF } from "../utils/pdfParser.js";
import Quiz from "../models/Quiz.js";
import { getDefaultSubjects } from "../services/defaultQuizSeeder.js";
import { isDBConnected } from "../config/database.js";
import fs from "fs";

/**
 * POST /api/quiz/generate
 * Upload a PDF, extract text, generate quiz, save to DB, return quiz data.
 */
export const generateQuizController = async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded. Please upload a PDF document.",
      });
    }

    filePath = req.file.path;
    const difficulty = req.body.difficulty || "Easy";
    const questionCount = Math.min(Math.max(parseInt(req.body.count) || 5, 1), 20);

    console.log(`\n📄 Processing: ${req.file.originalname} (${difficulty}, ${questionCount}Q)`);

    // Extract text from PDF
    const text = await extractTextFromPDF(filePath);

    if (!text || text.trim().length < 50) {
      return res.status(400).json({
        error: "Could not extract enough text from the PDF. The document may be image-based or too short.",
      });
    }

    console.log(`📝 Extracted ${text.length} characters`);

    // Generate quiz
    const questions = await generateQuiz(text, difficulty, questionCount);

    if (!questions || questions.length === 0) {
      return res.status(500).json({
        error: "Failed to generate questions. Please try again.",
      });
    }

    console.log(`✅ Generated ${questions.length} questions`);

    // Build quiz title from filename
    const title = req.file.originalname
      .replace(/\.[^.]+$/, "")          // Remove extension
      .replace(/[-_]/g, " ")            // Replace dashes/underscores
      .replace(/\b\w/g, (c) => c.toUpperCase()); // Title case

    // Attempt to save to database
    let quizId = null;
    try {
      const savedQuiz = await Quiz.create({
        title,
        difficulty,
        sourceFileName: req.file.originalname,
        questionCount: questions.length,
        questions,
      });
      quizId = savedQuiz._id;
      console.log(`💾 Saved to DB: ${quizId}`);
    } catch (dbErr) {
      console.warn("⚠️  DB save failed (running without persistence):", dbErr.message);
      // Generate a temporary ID so the flow still works
      quizId = `temp-${Date.now()}`;
    }

    res.json({
      quizId,
      title,
      difficulty,
      questionCount: questions.length,
      quiz: questions,
    });
  } catch (err) {
    console.error("❌ Quiz generation error:", err.message);
    res.status(500).json({
      error: err.message || "An unexpected error occurred during quiz generation.",
    });
  } finally {
    // Clean up uploaded file
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
};

/**
 * GET /api/quiz/:id
 * Fetch a quiz by its MongoDB ID.
 */
export const getQuizById = async (req, res) => {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "Database not available" });
  }
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    res.json(quiz);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ error: "Invalid quiz ID format" });
    }
    console.error("Fetch quiz error:", err.message);
    res.status(500).json({ error: "Failed to fetch quiz" });
  }
};

/**
 * GET /api/quiz/history
 * List all quizzes, most recent first.
 */
export const getQuizHistory = async (req, res) => {
  if (!isDBConnected()) {
    return res.json({ quizzes: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
  }
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const [quizzes, total] = await Promise.all([
      Quiz.find({})
        .select("title difficulty questionCount sourceFileName subject isDefault attempts createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Quiz.countDocuments({}),
    ]);

    // Add computed fields
    const enriched = quizzes.map((q) => ({
      ...q,
      attemptCount: q.attempts?.length || 0,
      bestScore: q.attempts?.length
        ? Math.max(...q.attempts.map((a) => Math.round((a.score / a.total) * 100)))
        : null,
      lastAttempt: q.attempts?.length
        ? q.attempts[q.attempts.length - 1].completedAt
        : null,
    }));

    res.json({
      quizzes: enriched,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Quiz history error:", err.message);
    res.status(500).json({ error: "Failed to fetch quiz history" });
  }
};

/**
 * POST /api/quiz/:id/attempt
 * Save a quiz attempt with score and answers.
 */
export const saveAttempt = async (req, res) => {
  if (!isDBConnected()) {
    return res.json({ message: "Attempt recorded (no DB)", attemptCount: 0, bestScore: 0 });
  }
  try {
    const { score, total, answers } = req.body;

    if (typeof score !== "number" || typeof total !== "number") {
      return res.status(400).json({ error: "Score and total are required" });
    }

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    quiz.attempts.push({
      score,
      total,
      answers: answers || [],
      completedAt: new Date(),
    });

    await quiz.save();

    res.json({
      message: "Attempt saved",
      attemptCount: quiz.attempts.length,
      bestScore: Math.max(...quiz.attempts.map((a) => Math.round((a.score / a.total) * 100))),
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ error: "Invalid quiz ID format" });
    }
    console.error("Save attempt error:", err.message);
    res.status(500).json({ error: "Failed to save attempt" });
  }
};

/**
 * GET /api/quiz/subject/:subject
 * Fetch quizzes for a specific subject.
 */
export const getQuizBySubject = async (req, res) => {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "Database not available. Start MongoDB to access subject quizzes." });
  }
  try {
    const subject = decodeURIComponent(req.params.subject);

    const quizzes = await Quiz.find({ subject })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    if (!quizzes.length) {
      return res.status(404).json({ error: `No quizzes found for subject: ${subject}` });
    }

    // Enrich with computed fields
    const enriched = quizzes.map((q) => ({
      ...q,
      attemptCount: q.attempts?.length || 0,
      bestScore: q.attempts?.length
        ? Math.max(...q.attempts.map((a) => Math.round((a.score / a.total) * 100)))
        : null,
    }));

    res.json({ quizzes: enriched });
  } catch (err) {
    console.error("Subject quiz error:", err.message);
    res.status(500).json({ error: "Failed to fetch subject quizzes" });
  }
};

/**
 * GET /api/quiz/subjects
 * List available default subjects.
 */
export const getSubjects = async (req, res) => {
  try {
    const subjects = getDefaultSubjects();

    // If DB not connected, return subjects without enrichment
    if (!isDBConnected()) {
      const basic = subjects.map((s) => ({
        ...s,
        quizCount: 0,
        defaultQuizId: null,
        questionCount: 0,
      }));
      return res.json({ subjects: basic });
    }

    // Enrich with quiz counts from DB
    const enriched = await Promise.all(
      subjects.map(async (s) => {
        const count = await Quiz.countDocuments({ subject: s.subject }).catch(() => 0);
        const quiz = await Quiz.findOne({ subject: s.subject, isDefault: true })
          .select("_id questionCount")
          .lean()
          .catch(() => null);

        return {
          ...s,
          quizCount: count,
          defaultQuizId: quiz?._id || null,
          questionCount: quiz?.questionCount || 0,
        };
      })
    );

    res.json({ subjects: enriched });
  } catch (err) {
    console.error("Subjects list error:", err.message);
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
};
