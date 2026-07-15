import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid unique identifier format.",
});

export const snoozeQueueSchema = {
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    hours: z.preprocess(
      (val) => (val ? parseFloat(val) : 24),
      z.number().positive("Snooze hours must be a positive number.")
    ).default(24),
  }),
};

export const queueIdSchema = {
  params: z.object({
    id: objectIdSchema,
  }),
};
