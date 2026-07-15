import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid unique identifier format.",
});

export const askTutorSchema = {
  body: z.object({
    question: z.string({
      required_error: "Question is required.",
    }).trim().min(3, "Question must be at least 3 characters long."),
    
    materialId: z.string().regex(/^[0-9a-fA-F]{24}$/, {
      message: "Invalid material identifier format.",
    }).nullable().optional().or(z.literal("")),
  }),
};

export const reindexMaterialSchema = {
  params: z.object({
    materialId: objectIdSchema,
  }),
};
