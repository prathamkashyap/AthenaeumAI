import express from "express";
import { followRecommendation, getRecommendations } from "../controllers/recommendationController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);
router.get("/dashboard", getRecommendations);
router.post("/follow", followRecommendation);

export default router;
