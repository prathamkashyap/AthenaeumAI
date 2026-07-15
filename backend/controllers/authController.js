import User from "../models/User.js";
import UserProgress from "../models/UserProgress.js";
import { v4 as uuidv4 } from "uuid";
import {
  createToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  hashPassword,
  verifyPassword,
} from "../utils/auth.js";
import { isDBConnected } from "../config/database.js";
import logger from "../utils/logger.js";

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: "/api/v1/auth",
};

const getMeta = (req) => ({
  ip:        req.ip || req.socket?.remoteAddress || "",
  userAgent: req.headers["user-agent"] || "",
});

// ─── Auth Response Helper ─────────────────────────────────────────────────────

const sendAuthResponse = async (res, user, req) => {
  const accessToken   = createToken(user);
  const family        = uuidv4();
  const { token: refreshToken } = await createRefreshToken(user._id, family, getMeta(req));

  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

  res.json({
    user:  user.toSafeJSON(),
    token: accessToken,
  });
};

// ─── Controllers ─────────────────────────────────────────────────────────────

export const signup = async (req, res) => {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "MongoDB is required for signup and progress tracking" });
  }

  const { name, email, password, program = "", semester = "" } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return res.status(409).json({ error: "An account already exists for this email" });
  }

  const user = await User.create({
    name: name.trim(),
    email,
    passwordHash: await hashPassword(password),
    profile: { program, semester, interests: [] },
  });

  await UserProgress.create({ user: user._id });

  logger.info("User signup", { userId: user._id, email: user.email });
  await sendAuthResponse(res.status(201), user, req);
};

export const login = async (req, res) => {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "MongoDB is required for login" });
  }

  const { email, password } = req.body;
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  logger.info("User login", { userId: user._id, email: user.email, ip: getMeta(req).ip });
  await sendAuthResponse(res, user, req);
};

export const me = async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
};

/**
 * PUT /api/v1/auth/profile
 * Update user profile information.
 */
export const updateProfile = async (req, res) => {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "MongoDB is required to update profile" });
  }

  const { name, program, semester, interests } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (name?.trim()) user.name = name.trim();
    if (program !== undefined) user.profile.program = program;
    if (semester !== undefined) user.profile.semester = semester;
    if (Array.isArray(interests)) user.profile.interests = interests;

    await user.save();
    
    logger.info("User profile updated", { userId: user._id });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    logger.error("Profile update failed", { error: err.message });
    res.status(500).json({ error: "Failed to update profile" });
  }
};

/**
 * POST /api/v1/auth/refresh
 * Accepts refreshToken from httpOnly cookie or request body.
 * Issues a new access token and rotated refresh token.
 */
export const refresh = async (req, res) => {
  const tokenString = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!tokenString) {
    return res.status(401).json({ error: "Refresh token is required" });
  }

  try {
    const { accessToken, refreshToken: newRefreshToken, user } = await rotateRefreshToken(
      tokenString,
      getMeta(req)
    );

    res.cookie("refreshToken", newRefreshToken, REFRESH_COOKIE_OPTIONS);
    logger.info("Token rotated", { userId: user._id });

    res.json({ token: accessToken, user: user.toSafeJSON() });
  } catch (err) {
    logger.warn("Refresh token rejected", { error: err.message, ip: getMeta(req).ip });
    res.clearCookie("refreshToken", { path: "/api/v1/auth" });
    res.status(err.status || 401).json({ error: err.message });
  }
};

/**
 * POST /api/v1/auth/logout
 * Revokes the current refresh token (logout from this device).
 */
export const logout = async (req, res) => {
  const tokenString = req.cookies?.refreshToken || req.body?.refreshToken;

  if (tokenString) {
    await revokeRefreshToken(tokenString).catch(() => {});
  }

  res.clearCookie("refreshToken", { path: "/api/v1/auth" });
  logger.info("User logout", { userId: req.user?._id });
  res.json({ message: "Logged out successfully" });
};
