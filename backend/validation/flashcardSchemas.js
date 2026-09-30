import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid unique identifier format.",
});

export const generateFlashcardSetSchema = {
  body: z.object({
    // "mistakes" builds a set from a saved attempt's wrong answers. It was
    // implemented in the service and used by the result page while missing from
    // this enum, so every request carrying it was rejected here before reaching
    // the controller and the feature never worked.
    sourceType: z.enum(["weak-topics", "quiz", "material", "mistakes"]),
    sourceId: z.string().regex(/^[0-9a-fA-F]{24}$/, {
      message: "Invalid source identifier format.",
    }).nullable().optional().or(z.literal("")),
    count: z.preprocess(
      (val) => (val ? parseInt(val, 10) : 12),
      z.number().int().min(1, "Flashcard count must be at least 1.").max(50, "Maximum of 50 flashcards permitted.")
    ).default(12),
  }).refine((data) => {
    // Every source that is selected from something must name it. "mistakes"
    // names the attempt, and omitting it is not a harmless default: the service
    // looks the attempt up by id, and Mongoose strips an undefined `_id` from a
    // filter, so a missing sourceId would silently match an arbitrary attempt of
    // this learner instead of reporting the bad request.
    if (["quiz", "material", "mistakes"].includes(data.sourceType) && !data.sourceId) {
      return false;
    }
    return true;
  }, {
    message: "sourceId is required when sourceType is quiz, material or mistakes.",
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
