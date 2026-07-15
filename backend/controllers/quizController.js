import { generateQuizFromAI as generateQuiz } from "../services/aiQuizService.js";
import { extractTextFromPDF } from "../utils/pdfParser.js";
import Quiz from "../models/Quiz.js";
import StudyMaterial from "../models/StudyMaterial.js";
import { isDBConnected } from "../config/database.js";
import { AIServiceError, DatabaseError, ValidationError, NotFoundError } from "../utils/errors.js";
import QuizAttempt from "../models/QuizAttempt.js";
import { getDefaultSubjects } from "../services/defaultQuizSeeder.js";
import { updateUserProgressFromAttempt } from "../services/progressService.js";
import { recordAttemptEvents } from "../services/learningEventService.js";
import { analyzeMistakesForAttempt } from "../services/mistakeAnalysisService.js";
import { enqueueFailedQuestionItems, rebuildReviewQueueForUser } from "../services/reviewQueueService.js";
import { indexStudyMaterialChunks } from "../services/embeddingService.js";
import logger from "../utils/logger.js";
import { jobQueue } from "../utils/jobQueue.js";
import { runInTransaction } from "../utils/dbTransactions.js";
import { normalizeTopic } from "../services/topicNormalizationService.js";
import fs from "fs";

/**
 * POST /api/v1/quiz/generate
 * Upload a PDF, extract text, generate quiz, save to DB, return quiz data.
 */
export const generateQuizController = async (req, res, next) => {
  let filePath = null;
  let keepUploadedFile = false;

  try {
    if (!req.file) {
      throw new ValidationError("No file uploaded. Please upload a PDF document.");
    }

    filePath = req.file.path;
    const difficulty = req.body.difficulty || "Easy";
    const questionCount = Math.min(Math.max(parseInt(req.body.count) || 5, 1), 20);
    const tags = String(req.body.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12);

    logger.info(`📄 Processing PDF upload: ${req.file.originalname}`, {
      requestId: req.requestId,
      difficulty,
      questionCount,
    });

    // Extract text from PDF
    const text = await extractTextFromPDF(filePath);

    if (!text || text.trim().length < 50) {
      throw new ValidationError("Could not extract enough text from the PDF. The document may be image-based or too short.");
    }

    logger.info(`📝 Extracted text contents successfully`, {
      requestId: req.requestId,
      textLength: text.length,
    });

    // Generate quiz
    const questions = await generateQuiz(text, difficulty, questionCount);

    if (!questions || questions.length === 0) {
      throw new AIServiceError("Failed to generate questions. Please try again.");
    }

    logger.info(`✅ Generated questions via AI service`, {
      requestId: req.requestId,
      questionCount: questions.length,
    });

    // Build quiz title from filename
    const title = req.file.originalname
      .replace(/\.[^.]+$/, "")          // Remove extension
      .replace(/[-_]/g, " ")            // Replace dashes/underscores
      .replace(/\b\w/g, (c) => c.toUpperCase()); // Title case

    const { savedQuiz, material } = await runInTransaction(async (session) => {
      const mat = await StudyMaterial.create([{
        user: req.user._id,
        title,
        originalFileName: req.file.originalname,
        storagePath: req.file.path,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        tags,
        extractedText: text,
        textPreview: text.slice(0, 700),
      }], { session });

      const quiz = await Quiz.create([{
        user: req.user._id,
        studyMaterial: mat[0]._id,
        title,
        difficulty,
        sourceFileName: req.file.originalname,
        questionCount: questions.length,
        questions,
      }], { session });

      return { savedQuiz: quiz[0], material: mat[0] };
    });

    keepUploadedFile = true;
    await jobQueue.enqueue(`RAG Index Material: ${material.title}`, {
      type: "INDEX_MATERIAL",
      data: { materialId: material._id },
    }, {
      deduplicationId: `index-material:${material._id}`,
    });

    material.linkedQuizzes.push(savedQuiz._id);
    await material.save();

    logger.info(`✅ Quiz and Material saved successfully`, {
      requestId: req.requestId,
      quizId: savedQuiz._id,
      materialId: material._id,
    });

    res.json({
      quizId: savedQuiz._id,
      materialId: material._id,
      title,
      difficulty,
      questionCount: questions.length,
      quiz: questions,
    });
  } catch (err) {
    next(err);
  } finally {
    if (filePath && !keepUploadedFile) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        logger.warn("Failed to delete temp file:", { filePath, error: e.message });
      }
    }
  }
};

/**
 * GET /api/v1/quiz/:id
 * Fetch a quiz by its MongoDB ID.
 */
export const getQuizById = async (req, res, next) => {
  if (!isDBConnected()) {
    return next(new DatabaseError("Database not available"));
  }
  try {
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      $or: [{ user: req.user._id }, { isDefault: true }],
    });

    if (!quiz) {
      return next(new NotFoundError("Quiz not found"));
    }

    res.json(quiz);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/quiz/history
 * List all quizzes, most recent first.
 */
export const getQuizHistory = async (req, res, next) => {
  if (!isDBConnected()) {
    return next(new DatabaseError("Database not available"));
  }
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    if (req.query.search) {
      filter.title = { $regex: req.query.search, $options: "i" };
    }
    if (req.query.difficulty) {
      filter.difficulty = req.query.difficulty;
    }

    const [quizzes, total] = await Promise.all([
      Quiz.find(filter)
        .select("title difficulty questionCount sourceFileName subject isDefault attempts createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Quiz.countDocuments(filter),
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
    next(err);
  }
};

/**
 * POST /api/v1/quiz/:id/attempt
 * Save a quiz attempt with score and answers.
 */
export const saveAttempt = async (req, res, next) => {
  if (!isDBConnected()) {
    return next(new DatabaseError("Database not available"));
  }
  try {
    const { score, total, answers, durationSeconds = 0 } = req.body;

    const quiz = await Quiz.findOne({
      _id: req.params.id,
      $or: [{ user: req.user._id }, { isDefault: true }],
    });

    if (!quiz) {
      return next(new NotFoundError("Quiz not found"));
    }

    const normalizedAnswers = (answers || []).map((selected, index) => {
      const question = quiz.questions[index];
      return {
        questionIndex: index,
        selected,
        correct: question?.answer ?? -1,
        isCorrect: selected === question?.answer,
        topic: normalizeTopic(question?.topic || "General"),
      };
    });

    const mistakeAnalyses = await analyzeMistakesForAttempt({
      quiz,
      normalizedAnswers,
      limit: 5,
    });

    const attempt = await QuizAttempt.create({
      user: req.user._id,
      quiz: quiz._id,
      studyMaterial: quiz.studyMaterial || null,
      score,
      total,
      accuracy: Math.round((score / Math.max(total, 1)) * 100),
      difficulty: quiz.difficulty,
      durationSeconds,
      answers: normalizedAnswers,
      mistakeAnalyses,
    });

    quiz.attempts.push({
      score,
      total,
      answers: answers || [],
      completedAt: new Date(),
    });

    await quiz.save();

    await jobQueue.enqueue(`Sync Attempt Analytics & Rebuild Queue - User ${req.user._id}`, {
      type: "SYNC_ATTEMPT",
      data: {
        attemptId: attempt._id,
        userId: req.user._id,
        quizId: quiz._id,
      },
    }, {
      deduplicationId: `sync-attempt:${attempt._id}`,
    });

    logger.info("Saved quiz attempt success", {
      requestId: req.requestId,
      attemptId: attempt._id,
      score,
      total,
    });

    res.json({
      message: "Attempt saved",
      attemptId: attempt._id,
      mistakeAnalyses,
      attemptCount: quiz.attempts.length,
      bestScore: Math.max(...quiz.attempts.map((a) => Math.round((a.score / a.total) * 100))),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/quiz/subject/:subject
 * Fetch quizzes for a specific subject.
 */
export const getQuizBySubject = async (req, res, next) => {
  if (!isDBConnected()) {
    return next(new DatabaseError("Database not available. Start MongoDB to access subject quizzes."));
  }
  try {
    const subject = decodeURIComponent(req.params.subject);

    const quizzes = await Quiz.find({ subject, $or: [{ user: req.user._id }, { isDefault: true }] })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    if (!quizzes.length) {
      return next(new NotFoundError(`No quizzes found for subject: ${subject}`));
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
    next(err);
  }
};

/**
 * GET /api/v1/quiz/subjects
 * List available default subjects.
 */
export const getSubjects = async (req, res, next) => {
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
        const count = await Quiz.countDocuments({
          subject: s.subject,
          $or: [{ user: req.user._id }, { isDefault: true }],
        }).catch(() => 0);
        const quiz = await Quiz.findOne({
          subject: s.subject,
          $or: [{ user: req.user._id }, { isDefault: true }],
        })
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
    next(err);
  }
};

export const deleteQuiz = async (req, res, next) => {
  try {
    const quizId = req.params.id;
    const quiz = await Quiz.findOneAndUpdate(
      { _id: quizId, user: req.user._id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );

    if (!quiz) {
      return next(new NotFoundError("Quiz not found"));
    }

    res.json({ message: "Quiz soft-deleted successfully" });
  } catch (err) {
    next(err);
  }
};
