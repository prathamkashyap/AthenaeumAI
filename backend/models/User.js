import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    profile: {
      program: { type: String, default: "" },
      semester: { type: String, default: "" },
      interests: { type: [String], default: [] },
    },
    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      lastStudyDate: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    profile: this.profile,
    streak: this.streak,
    createdAt: this.createdAt,
  };
};

export default mongoose.model("User", userSchema);
