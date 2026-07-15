import logger from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

export const globalErrorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Handle specific errors
  if (err.message?.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message, requestId: req.requestId });
  }

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum size is 10MB.", requestId: req.requestId });
  }

  if (err.message?.includes("Only PDF")) {
    return res.status(400).json({ error: err.message, requestId: req.requestId });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Database validation failed",
      details: Object.values(err.errors || {}).map((e) => e.message),
      requestId: req.requestId,
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      error: `Invalid identifier format for path: ${err.path}`,
      requestId: req.requestId,
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  
  if (statusCode >= 500) {
    logger.error(err.message || "Unhandled Exception", { 
      requestId: req.requestId, userId: req.user?._id, error: err.message, stack: err.stack, route: req.originalUrl 
    });
  } else {
    logger.warn("Client Error", { 
      requestId: req.requestId, userId: req.user?._id, error: err.message, status: statusCode, route: req.originalUrl 
    });
  }

  const errorResponse = {
    error: err.message || "Internal Server Error",
    requestId: req.requestId,
    ...(err.details && { details: err.details }),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack })
  };

  res.status(statusCode).json(errorResponse);
};
