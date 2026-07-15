import mongoose from "mongoose";

const studyMaterialSchema = new mongoose.Schema(
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
    originalFileName: {
      type: String,
      required: true,
    },
    storagePath: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      default: "application/pdf",
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    extractedText: {
      type: String,
      default: "",
    },
    textPreview: {
      type: String,
      default: "",
    },
    linkedQuizzes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
    }],
    linkedFlashcardSets: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "FlashcardSet",
    }],
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

studyMaterialSchema.index({ user: 1, title: "text", tags: "text", textPreview: "text" });

studyMaterialSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  if (typeof next === "function") next();
});

export default mongoose.model("StudyMaterial", studyMaterialSchema);
