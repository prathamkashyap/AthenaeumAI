import express from "express";
import { login, me, signup, refresh, logout, updateProfile } from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { loginSchema, signupSchema } from "../validation/authSchemas.js";

const router = express.Router();

router.post("/signup",  validateRequest(signupSchema), signup);
router.post("/login",   validateRequest(loginSchema),  login);
router.get("/me",       requireAuth,                   me);
router.put("/profile",  requireAuth,                   updateProfile);
router.post("/refresh",                                refresh);
router.post("/logout",                                 logout);

export default router;
