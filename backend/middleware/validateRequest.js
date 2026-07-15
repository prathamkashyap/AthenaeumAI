import { ValidationError } from "../utils/errors.js";

/**
 * Validates request components against Zod schemas.
 * @param {Object} schemas - Contains optional body, query, params, and file Zod schemas.
 */
export const validateRequest = (schemas) => {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.file) {
        if (!req.file) {
          throw new ValidationError("No file uploaded. Please upload a PDF document.");
        }
        req.file = schemas.file.parse(req.file);
      }
      next();
    } catch (err) {
      if (err.name === "ZodError") {
        const issues = err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return next(new ValidationError("Request validation failed", issues));
      }
      next(err);
    }
  };
};

export default validateRequest;
