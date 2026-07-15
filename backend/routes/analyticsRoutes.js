import express from "express";
import {
  dashboardAnalytics,
  listLearningEvents,
} from "../controllers/analyticsController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);
router.get("/dashboard", dashboardAnalytics);
router.get("/events", listLearningEvents);

export default router;
