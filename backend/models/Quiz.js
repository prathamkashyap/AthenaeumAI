import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
  },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: (v) => v.length === 4,
      message: "Each question must have exactly 4 options",
    },
  },
  answer: {
    type: Number,
    required: true,
    min: 0,
    max: 3,
  },
  explanation: {
    type: String,
    default: "",
  },
  topic: {
    type: String,
    default: "",
  },
  cognitiveLevel: {
    type: String,
    enum: ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"],
    default: "Remember",
  },
});

const attemptSchema = new mongoose.Schema({
  score: {
    type: Number,
    required: true,
  },
  total: {
    type: Number,
    required: true,
  },
  answers: {
    type: [Number],
    default: [],
  },
  completedAt: {
    type: Date,
    default: Date.now,
  },
});

const quizSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    studyMaterial: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudyMaterial",
      default: null,
      index: true,
    },
    title: {
      type: String,
      default: "Untitled Quiz",
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Easy",
    },
    sourceFileName: {
      type: String,
      default: "",
    },
    questionCount: {
      type: Number,
      default: 0,
    },
    subject: {
      type: String,
      default: "",
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    questions: [questionSchema],
    attempts: [attemptSchema],
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

quizSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  if (typeof next === "function") next();
});

// Virtual for best score
quizSchema.virtual("bestScore").get(function () {
  if (!this.attempts.length) return null;
  return Math.max(...this.attempts.map((a) => Math.round((a.score / a.total) * 100)));
});

// Ensure virtuals are included in JSON
quizSchema.set("toJSON", { virtuals: true });
quizSchema.set("toObject", { virtuals: true });

const Quiz = mongoose.model("Quiz", quizSchema);

export default Quiz;
