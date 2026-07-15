import mongoose from "mongoose";

const learningEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: {
      type: String,
      default: "",
      index: true,
    },
    topic: {
      type: String,
      default: "General",
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "quiz_attempt",
        "flashcard_review",
        "recommendation_followed",
        "revision_completed",
        "ai_tutoring_interaction",
      ],
      required: true,
      index: true,
    },
    result: {
      type: String,
      enum: ["correct", "incorrect", "completed", "partial", "skipped", "reviewed"],
      default: "completed",
    },
    confidence: {
      type: Number,
      default: 0,
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard", ""],
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

learningEventSchema.index({ user: 1, createdAt: -1 });
learningEventSchema.index({ user: 1, eventType: 1, createdAt: -1 });
learningEventSchema.index({ user: 1, topic: 1, createdAt: -1 });

export default mongoose.model("LearningEvent", learningEventSchema);
