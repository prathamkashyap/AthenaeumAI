import express from "express";
import {
  getMaterial,
  listMaterials,
  updateMaterial,
  deleteMaterial,
} from "../controllers/libraryController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { quizIdSchema } from "../validation/quizSchemas.js";

const router = express.Router();

router.use(requireAuth);
router.get("/", listMaterials);
router.get("/:id", validateRequest(quizIdSchema), getMaterial);
router.patch("/:id", validateRequest(quizIdSchema), updateMaterial);
router.delete("/:id", validateRequest(quizIdSchema), deleteMaterial);

export default router;
