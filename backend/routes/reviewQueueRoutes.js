import express from "express";
import {
  completeReviewQueue,
  getReviewQueue,
  rebuildReviewQueue,
  snoozeReviewQueue,
} from "../controllers/reviewQueueController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { queueIdSchema, snoozeQueueSchema } from "../validation/reviewQueueSchemas.js";

const router = express.Router();

router.use(requireAuth);
router.get("/", getReviewQueue);
router.post("/rebuild", rebuildReviewQueue);

router.post(
  "/:id/complete",
  validateRequest(queueIdSchema),
  completeReviewQueue
);

router.post(
  "/:id/snooze",
  validateRequest(snoozeQueueSchema),
  snoozeReviewQueue
);

export default router;
