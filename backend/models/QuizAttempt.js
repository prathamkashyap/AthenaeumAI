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
    // Durable idempotency state for the SYNC_ATTEMPT background job. The
    // attempt document is the only place that needs to remember whether this
    // logical attempt's learner effects have already been applied, so no
    // separate idempotency collection is required. The status is flipped in the
    // same transaction that writes the effects, so a crash can never leave an
    // attempt marked processed without its learner update.
    sync: {
      status: {
        type: String,
        enum: ["pending", "processed"],
        default: "pending",
      },
      appliedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

quizAttemptSchema.index({ user: 1, createdAt: -1 });

quizAttemptSchema.index({ user: 1, quiz: 1, createdAt: -1 });

export default mongoose.model("QuizAttempt", quizAttemptSchema);
