import User from "../models/User.js";
import { verifyToken } from "../utils/auth.js";
import { isDBConnected } from "../config/database.js";

export const requireAuth = async (req, res, next) => {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "Database required for authenticated learning workspace" });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? verifyToken(token) : null;

  if (!payload?.sub) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "User session is no longer valid" });
  }

  req.user = user;
  next();
};
