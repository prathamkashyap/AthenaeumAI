import express from "express";
import upload from "../middleware/upload.js";
import {
  generateQuizController,
  getQuizById,
  getQuizHistory,
  getQuizBySubject,
  getSubjects,
  saveAttempt,
} from "../controllers/quizController.js";

const router = express.Router();

// POST /api/quiz/generate — Upload PDF + generate quiz
router.post("/generate", upload.single("file"), generateQuizController);

// GET /api/quiz/history — List all quizzes
router.get("/history", getQuizHistory);

// GET /api/quiz/subjects — List available subjects
router.get("/subjects", getSubjects);

// GET /api/quiz/subject/:subject — Fetch quizzes by subject
router.get("/subject/:subject", getQuizBySubject);

// GET /api/quiz/:id — Fetch quiz by ID
router.get("/:id", getQuizById);

// POST /api/quiz/:id/attempt — Save a quiz attempt
router.post("/:id/attempt", saveAttempt);

export default router;