import express from "express";
import {
  askTutor,
  askTutorStream,
  reindexMaterialForTutor,
  getTutorHistory,
} from "../controllers/tutorController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { userAiQuota } from "../middleware/aiQuotaMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { askTutorSchema, reindexMaterialSchema } from "../validation/tutorSchemas.js";

const router = express.Router();

router.use(requireAuth);

router.get("/history", getTutorHistory);

router.post(
  "/ask",
  userAiQuota({ max: 20, windowMs: 60 * 1000, label: "AI tutor" }),
  validateRequest(askTutorSchema),
  askTutor
);

router.post(
  "/ask/stream",
  userAiQuota({ max: 20, windowMs: 60 * 1000, label: "AI tutor stream" }),
  validateRequest(askTutorSchema),
  askTutorStream
);

router.post(
  "/materials/:materialId/reindex",
  validateRequest(reindexMaterialSchema),
  reindexMaterialForTutor
);

export default router;
