import mongoose from "mongoose";

const flashcardSchema = new mongoose.Schema(
  {
    front: { type: String, required: true },
    back: { type: String, required: true },
    topic: { type: String, default: "General" },
    sourceQuestionIndex: { type: Number, default: null },
    review: {
      nextReviewAt: { type: Date, default: Date.now },
      easeFactor: { type: Number, default: 2.5 },
      interval: { type: Number, default: 0 },
      repetitions: { type: Number, default: 0 },
      ease: { type: Number, default: 2.5 },
      intervalDays: { type: Number, default: 0 },
      dueAt: { type: Date, default: Date.now },
      lastReviewedAt: { type: Date, default: null },
      reviewCount: { type: Number, default: 0 },
    },
  },
  { _id: true }
);

const flashcardSetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: ["material", "quiz", "weak-topics"],
      required: true,
    },
    studyMaterial: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudyMaterial",
      default: null,
      index: true,
    },
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      default: null,
      index: true,
    },
    cards: {
      type: [flashcardSchema],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

flashcardSetSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  if (typeof next === "function") next();
});

flashcardSetSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("FlashcardSet", flashcardSetSchema);
