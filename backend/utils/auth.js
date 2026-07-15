import crypto from "crypto";
import RefreshToken from "../models/RefreshToken.js";

// ─── Token TTLs ───────────────────────────────────────────────────────────────
const ACCESS_TOKEN_TTL_SECONDS  = 60 * 15;          // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const getSecret = () =>
  process.env.JWT_SECRET || process.env.SESSION_SECRET || "athenaeum-dev-secret-change-me";

// ─── Base64-URL helpers ───────────────────────────────────────────────────────

const base64UrlEncode = (value) =>
  Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const base64UrlDecode = (value) => {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
};

const sign = (input) =>
  crypto
    .createHmac("sha256", getSecret())
    .update(input)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

// ─── Access Token (short-lived JWT, 15 minutes) ───────────────────────────────

/**
 * Creates a short-lived (15 min) access token for the given user.
 * @param {object} user - Mongoose User document
 * @returns {string} Signed JWT access token
 */
export const createToken = (user) => {
  const header  = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncode({
    sub:   String(user._id),
    email: user.email,
    name:  user.name,
    iat:   Math.floor(Date.now() / 1000),
    exp:   Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
  });
  const signature = sign(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
};

/**
 * Verifies a JWT access token.
 * @param {string} token
 * @returns {object|null} Decoded payload or null if invalid/expired
 */
export const verifyToken = (token) => {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  if (sign(`${header}.${payload}`) !== signature) return null;

  const decoded = base64UrlDecode(payload);
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
};

// ─── Refresh Token (long-lived, stored in DB) ─────────────────────────────────

/**
 * Generates a cryptographically random opaque refresh token string.
 * @returns {string} 64-byte hex token
 */
export const generateRefreshTokenString = () =>
  crypto.randomBytes(64).toString("hex");

/**
 * Hashes a refresh token string for safe storage in MongoDB.
 * @param {string} token
 * @returns {string} SHA-256 hex hash
 */
export const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

/**
 * Creates and persists a new refresh token for a user.
 * @param {string} userId
 * @param {string} family  - Token family (used for reuse detection)
 * @param {object} meta    - { ip, userAgent }
 * @returns {{ token: string, record: RefreshToken }}
 */
export const createRefreshToken = async (userId, family, meta = {}) => {
  const token     = generateRefreshTokenString();
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  const record = await RefreshToken.create({
    user:         userId,
    tokenHash,
    family,
    expiresAt,
    createdByIp:  meta.ip       || "",
    userAgent:    meta.userAgent || "",
  });

  return { token, record };
};

/**
 * Rotates a refresh token: revokes the old one, issues a new one.
 * Detects token reuse (reuse = revoke entire family).
 * @param {string} oldTokenString
 * @param {object} meta - { ip, userAgent }
 * @returns {{ accessToken: string, refreshToken: string, user: object }}
 */
export const rotateRefreshToken = async (oldTokenString, meta = {}) => {
  const User = (await import("../models/User.js")).default;

  const hash       = hashRefreshToken(oldTokenString);
  const storedToken = await RefreshToken.findOne({ tokenHash: hash });

  if (!storedToken) {
    throw Object.assign(new Error("Refresh token not found"), { status: 401 });
  }

  if (storedToken.isRevoked()) {
    // Token reuse detected — revoke entire family
    await RefreshToken.updateMany(
      { user: storedToken.user, family: storedToken.family, revokedAt: null },
      { revokedAt: new Date() }
    );
    throw Object.assign(new Error("Token reuse detected. All sessions revoked."), { status: 401 });
  }

  if (storedToken.isExpired()) {
    throw Object.assign(new Error("Refresh token expired"), { status: 401 });
  }

  // Revoke old token
  storedToken.revokedAt = new Date();
  await storedToken.save();

  // Issue new tokens in same family
  const user               = await User.findById(storedToken.user);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

  const accessToken                = createToken(user);
  const { token: newRefreshToken } = await createRefreshToken(user._id, storedToken.family, meta);

  return { accessToken, refreshToken: newRefreshToken, user };
};

/**
 * Revokes a specific refresh token (logout).
 * @param {string} tokenString
 */
export const revokeRefreshToken = async (tokenString) => {
  const hash = hashRefreshToken(tokenString);
  await RefreshToken.findOneAndUpdate(
    { tokenHash: hash, revokedAt: null },
    { revokedAt: new Date() }
  );
};

// ─── Password Hashing ─────────────────────────────────────────────────────────

export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
  return `${salt}:${hash}`;
};

export const verifyPassword = async (password, storedHash) => {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const candidate = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  const stored = Buffer.from(hash, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
};
