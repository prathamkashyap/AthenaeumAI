import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: "Invalid unique identifier format.",
});

export const fileSchema = z.object({
  fieldname: z.string(),
  originalname: z.string(),
  mimetype: z.string().refine((val) => val === "application/pdf", {
    message: "Only PDF documents are allowed.",
  }),
  size: z.number().max(10 * 1024 * 1024, {
    message: "File size exceeds the 10MB limit.",
  }),
  path: z.string(),
});

export const generateQuizSchema = {
  file: fileSchema,
  body: z.object({
    difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Easy"),
    count: z.preprocess(
      (val) => (val ? parseInt(val, 10) : 5),
      z.number().int().min(1, "Question count must be at least 1.").max(20, "Maximum of 20 questions permitted.")
    ).default(5),
    tags: z.string().trim().optional().default(""),
  }),
};

export const saveAttemptSchema = {
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    score: z.number().int().min(0, "Score cannot be negative."),
    total: z.number().int().min(1, "Total questions must be at least 1."),
    answers: z.array(z.number().int().min(-1, "Option indexes cannot be less than -1.")),
    durationSeconds: z.preprocess(
      (val) => (val ? parseFloat(val) : 0),
      z.number().min(0, "Duration cannot be negative.")
    ).default(0),
  }),
};

export const quizIdSchema = {
  params: z.object({
    id: objectIdSchema,
  }),
};

export const subjectParamsSchema = {
  params: z.object({
    subject: z.string().trim().min(1, "Subject path parameter cannot be empty."),
  }),
};
