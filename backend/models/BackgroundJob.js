import mongoose from "mongoose";

/**
 * Background job records.
 *
 * These describe *background processing*, never the business record the work acts
 * on. A `BackgroundJob` is not evidence that a `StudyMaterial`, `Quiz` or
 * `QuizAttempt` exists: the business record is the source of truth for that, and
 * it is committed before the job is ever created.
 *
 * The states are the public contract and are deliberately few. `pending` means
 * the record exists but the queue has not accepted the work yet; `not_scheduled`
 * means the enqueue was attempted and refused, which is the state Task 12 already
 * reports and which must never be presented as queued work.
 */
export const BACKGROUND_JOB_STATUS = Object.freeze([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "not_scheduled",
]);

/** Statuses a job can no longer leave. Updates must not overwrite these. */
export const TERMINAL_BACKGROUND_JOB_STATUS = Object.freeze([
  "completed",
  "failed",
  "not_scheduled",
]);

const backgroundJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["INDEX_MATERIAL", "SYNC_ATTEMPT"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: BACKGROUND_JOB_STATUS,
      default: "pending",
      index: true,
    },
    /**
     * The business record this job acts on. Kept for operator diagnosis and for
     * clients that want to know what is being processed; never a substitute for
     * reading that record itself.
     */
    resource: {
      materialId: { type: mongoose.Schema.Types.ObjectId, ref: "StudyMaterial", default: null },
      quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", default: null },
      attemptId: { type: mongoose.Schema.Types.ObjectId, ref: "QuizAttempt", default: null },
    },
    /** BullMQ's own job id. Operational correlation only; never part of the public response. */
    queueJobId: { type: String, default: null },
    /**
     * Failure detail safe to return to a client. Internal causes are logged at the
     * point of failure and never stored here.
     */
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
    },
    startedAt: { type: Date, default: null },
    /**
     * Set on every terminal transition. Its TTL index is the retention policy, so
     * only finished jobs are ever removed automatically: a job that is still
     * pending, queued or running is retained until it actually resolves.
     */
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

backgroundJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("BackgroundJob", backgroundJobSchema);
