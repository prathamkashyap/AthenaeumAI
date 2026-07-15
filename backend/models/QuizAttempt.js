import mongoose from "mongoose";

const answerSchema = new mongoose.Schema(
  {
    questionIndex: { type: Number, required: true },
    selected: { type: Number, default: -1 },
    correct: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    topic: { type: String, default: "General" },
  },
  { _id: false }
);

const mistakeAnalysisSchema = new mongoose.Schema(
  {
    questionIndex: { type: Number, required: true },
    topic: { type: String, default: "General" },
    misconception: { type: String, default: "" },
    clarification: { type: String, default: "" },
    distractorReason: { type: String, default: "" },
    revisionSuggestion: { type: String, default: "" },
    relatedFlashcards: { type: [String], default: [] },
  },
  { _id: false }
);

const quizAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true,
      index: true,
    },
    studyMaterial: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudyMaterial",
      default: null,
      index: true,
    },
    score: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
      required: true,
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Easy",
    },
    durationSeconds: {
      type: Number,
      default: 0,
    },
    answers: {
      type: [answerSchema],
      default: [],
    },
    mistakeAnalyses: {
      type: [mistakeAnalysisSchema],
      default: [],
    },
  },
  { timestamps: true }
);

quizAttemptSchema.index({ user: 1, createdAt: -1 });

quizAttemptSchema.index({ user: 1, quiz: 1, createdAt: -1 });

export default mongoose.model("QuizAttempt", quizAttemptSchema);
