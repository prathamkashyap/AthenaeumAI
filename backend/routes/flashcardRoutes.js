import express from "express";
import {
  generateFlashcardSet,
  listDueFlashcards,
  listFlashcardSets,
  reviewFlashcard,
  deleteFlashcardSet,
} from "../controllers/flashcardController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { userAiQuota } from "../middleware/aiQuotaMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  generateFlashcardSetSchema,
  reviewFlashcardSchema,
} from "../validation/flashcardSchemas.js";
import { quizIdSchema } from "../validation/quizSchemas.js";

const router = express.Router();

router.use(requireAuth);
router.get("/due", listDueFlashcards);
router.get("/", listFlashcardSets);

router.post(
  "/generate",
  userAiQuota({ max: 8, windowMs: 60 * 1000, label: "Flashcard generation" }),
  validateRequest(generateFlashcardSetSchema),
  generateFlashcardSet
);

router.post(
  "/:setId/cards/:cardId/review",
  validateRequest(reviewFlashcardSchema),
  reviewFlashcard
);

router.delete(
  "/:id",
  validateRequest(quizIdSchema),
  deleteFlashcardSet
);

export default router;
