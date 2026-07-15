import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid unique identifier format.",
});

export const generateFlashcardSetSchema = {
  body: z.object({
    sourceType: z.enum(["weak-topics", "quiz", "material"]),
    sourceId: z.string().regex(/^[0-9a-fA-F]{24}$/, {
      message: "Invalid source identifier format.",
    }).nullable().optional().or(z.literal("")),
    count: z.preprocess(
      (val) => (val ? parseInt(val, 10) : 12),
      z.number().int().min(1, "Flashcard count must be at least 1.").max(50, "Maximum of 50 flashcards permitted.")
    ).default(12),
  }).refine((data) => {
    if ((data.sourceType === "quiz" || data.sourceType === "material") && !data.sourceId) {
      return false;
    }
    return true;
  }, {
    message: "sourceId is required when sourceType is quiz or material.",
    path: ["sourceId"],
  }),
};

export const reviewFlashcardSchema = {
  params: z.object({
    setId: objectIdSchema,
    cardId: objectIdSchema,
  }),
  body: z.object({
    rating: z.enum(["easy", "good", "hard", "again"]),
  }),
};
