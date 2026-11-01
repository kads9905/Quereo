import mongoose, { Schema } from "mongoose";
import { SUPPORTED_TYPES } from "../adapters/index.js";

// A database the user wants to query and monitor ("target database").
const connectionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    type: {
      type: String,
      enum: SUPPORTED_TYPES,
      required: true,
    },
    host: { type: String, required: true, trim: true },
    port: { type: Number, required: true, min: 1, max: 65535 },
    database: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true },
    // AES-256-GCM encrypted, never returned by the API
    passwordEnc: { type: String, required: true, select: false },
    ssl: { type: Boolean, default: false },
    // MongoDB only: host is a DNS seed list (mongodb+srv://), e.g. MongoDB Atlas
    srv: { type: Boolean, default: false },
    // Read-only connections run every query inside a READ ONLY transaction,
    // so a stray UPDATE or DROP cannot change anything
    readOnly: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.passwordEnc;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Connection names are unique per user
connectionSchema.index({ user: 1, name: 1 }, { unique: true });

export const Connection = mongoose.model("Connection", connectionSchema);
