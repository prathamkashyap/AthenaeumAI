import mongoose from "mongoose";

/**
 * RefreshToken — stores long-lived refresh tokens for JWT rotation.
 * Tokens are hashed before storage; only the hash is persisted.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    family: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    createdByIp: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ user: 1, revokedAt: 1 });

refreshTokenSchema.methods.isExpired = function () {
  return new Date() >= this.expiresAt;
};

refreshTokenSchema.methods.isRevoked = function () {
  return this.revokedAt !== null;
};

refreshTokenSchema.methods.isActive = function () {
  return !this.isRevoked() && !this.isExpired();
};

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
export default RefreshToken;
