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
    // Which question of the attempt this item came from, for `failed_question`
    // items. Part of the item's identity rather than a detail of `metadata`: a
    // learner can miss two questions that share a topic, and before this existed
    // those two collapsed into a single row, so one diagnosis was silently lost
    // while the UI still labelled the surviving card with a specific `Q{n}`.
    //
    // Deliberately nullable and never defaulted to 0. Only `failed_question`
    // carries it, so topic and flashcard items must index and match as "absent";
    // a 0 default would make them collide on a fabricated question 0.
    questionIndex: {
      type: Number,
      default: null,
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
    // Matches the application-level filter in reviewQueueService.js. Changing this
    // key spec changes the index NAME, and Mongoose's automatic index build only
    // ever creates indexes -- it never drops the superseded one. A deployment that
    // does not run `npm run indexes:sync` therefore keeps the old coarse unique
    // index in force and keeps rejecting the very insert this change permits.
    questionIndex: 1,
  },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  }
);

reviewQueueSchema.index({ user: 1, status: 1, "source.flashcardSet": 1, "source.flashcardId": 1 });

export default mongoose.model("ReviewQueue", reviewQueueSchema);
