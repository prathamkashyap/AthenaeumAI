import mongoose from "mongoose";

const topicProgressSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    subject: { type: String, default: "" },
    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    mastery: { type: Number, default: 0 },
    weaknessScore: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    lastWrongAt: { type: Date, default: null },
    lastPracticedAt: { type: Date, default: null },
    recommendedDifficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Easy",
    },
  },
  { _id: false }
);

const userProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    totals: {
      quizzesTaken: { type: Number, default: 0 },
      questionsAnswered: { type: Number, default: 0 },
      correctAnswers: { type: Number, default: 0 },
      averageAccuracy: { type: Number, default: 0 },
    },
    topics: {
      type: [topicProgressSchema],
      default: [],
    },
    achievements: {
      type: [
        {
          id: { type: String, required: true },
          title: { type: String, required: true },
          description: { type: String, default: "" },
          unlockedAt: { type: Date, default: Date.now },
        }
      ],
      default: [],
    },
  },
  { timestamps: true }
);

userProgressSchema.index({ user: 1, "topics.topic": 1 });

export default mongoose.model("UserProgress", userProgressSchema);
