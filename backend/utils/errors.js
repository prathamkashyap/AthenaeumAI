export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true; // Marks operational errors that we anticipate

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message || "Validation failed", 400);
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message) {
    super(message || "Authentication credentials missing or invalid", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message) {
    super(message || "You do not have permission to access this resource", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message || "Resource not found", 404);
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message || "A resource conflict occurred", 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message) {
    super(message || "Too many requests. Please try again later.", 429);
  }
}

export class AIServiceError extends AppError {
  constructor(message, originalError = null) {
    super(message || "Failed to communicate with AI service", 502);
    this.originalError = originalError;
  }
}

export class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message || "Database service error", 503);
    this.originalError = originalError;
  }
}

export class QueueEnqueueError extends AppError {
  constructor(message, originalError = null) {
    super(message || "Background processing is temporarily unavailable", 503);
    this.originalError = originalError;
  }
}
