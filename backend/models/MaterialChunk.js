import mongoose from "mongoose";

const materialChunkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studyMaterial: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudyMaterial",
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    chunkText: {
      type: String,
      required: true,
    },
    textPreview: {
      type: String,
      default: "",
    },
    embedding: {
      type: [Number],
      default: [],
    },
    embeddingModel: {
      type: String,
      default: "local-hash-v1",
    },
    tokenEstimate: {
      type: Number,
      default: 0,
    },
    sourceTitle: {
      type: String,
      default: "",
    },
    topics: {
      type: [String],
      default: [],
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

materialChunkSchema.index({ user: 1, studyMaterial: 1, chunkIndex: 1 }, { unique: true });
materialChunkSchema.index({ user: 1, chunkText: "text", textPreview: "text", topics: "text" });

export default mongoose.model("MaterialChunk", materialChunkSchema);
