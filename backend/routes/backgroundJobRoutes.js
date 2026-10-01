import express from "express";
import {
  getBackgroundJobStatus,
  retryBackgroundJob,
} from "../controllers/backgroundJobController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// Job status is always read in the context of its owner, so authentication is
// required for every route here.
router.use(requireAuth);

router.get("/:id", getBackgroundJobStatus);
router.post("/:id/retry", retryBackgroundJob);

export default router;
