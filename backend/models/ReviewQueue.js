import mongoose from "mongoose";

const reviewQueueSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ["weak_topic", "failed_question", "due_flashcard", "low_confidence_topic", "overdue_review"],
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
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    dueAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "completed", "dismissed"],
      default: "open",
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    source: {
      quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", default: null },
      attempt: { type: mongoose.Schema.Types.ObjectId, ref: "QuizAttempt", default: null },
      flashcardSet: { type: mongoose.Schema.Types.ObjectId, ref: "FlashcardSet", default: null },
      flashcardId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

reviewQueueSchema.index({ user: 1, status: 1, priority: -1, dueAt: 1 });
reviewQueueSchema.index(
  {
    user: 1,
    itemType: 1,
    topic: 1,
    "source.quiz": 1,
    "source.attempt": 1,
    "source.flashcardSet": 1,
    "source.flashcardId": 1,
  },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  }
);

reviewQueueSchema.index({ user: 1, status: 1, "source.flashcardSet": 1, "source.flashcardId": 1 });

export default mongoose.model("ReviewQueue", reviewQueueSchema);
