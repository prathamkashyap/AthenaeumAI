import express from "express";
import { getBackgroundJobStatus } from "../controllers/backgroundJobController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// Job status is always read in the context of its owner, so authentication is
// required for every route here.
router.use(requireAuth);

router.get("/:id", getBackgroundJobStatus);

export default router;
