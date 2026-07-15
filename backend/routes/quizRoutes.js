import express from "express";
import upload from "../middleware/upload.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { userAiQuota } from "../middleware/aiQuotaMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  generateQuizSchema,
  saveAttemptSchema,
  quizIdSchema,
  subjectParamsSchema,
} from "../validation/quizSchemas.js";
import {
  generateQuizController,
  getQuizById,
  getQuizHistory,
  getQuizBySubject,
  getSubjects,
  saveAttempt,
  deleteQuiz,
} from "../controllers/quizController.js";

const router = express.Router();

router.use(requireAuth);

// POST /api/quiz/generate — Upload PDF + generate quiz
router.post(
  "/generate",
  userAiQuota({ max: 5, windowMs: 60 * 1000, label: "Quiz generation" }),
  upload.single("file"),
  validateRequest(generateQuizSchema),
  generateQuizController
);

// GET /api/quiz/history — List all quizzes
router.get("/history", getQuizHistory);

// GET /api/quiz/subjects — List available subjects
router.get("/subjects", getSubjects);

// GET /api/quiz/subject/:subject — Fetch quizzes by subject
router.get("/subject/:subject", validateRequest(subjectParamsSchema), getQuizBySubject);

// GET /api/quiz/:id — Fetch quiz by ID
router.get("/:id", validateRequest(quizIdSchema), getQuizById);

// DELETE /api/quiz/:id — Soft delete quiz by ID
router.delete("/:id", validateRequest(quizIdSchema), deleteQuiz);

// POST /api/quiz/:id/attempt — Save a quiz attempt
router.post(
  "/:id/attempt",
  userAiQuota({ max: 20, windowMs: 60 * 1000, label: "Mistake analysis" }),
  validateRequest(saveAttemptSchema),
  saveAttempt
);

export default router;
