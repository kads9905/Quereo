import mongoose, { Schema } from "mongoose";

const savedQuerySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    connection: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    sql: { type: String, required: true, maxlength: 20_000 },
  },
  { timestamps: true }
);

savedQuerySchema.index({ user: 1, connection: 1, updatedAt: -1 });

export const SavedQuery = mongoose.model("SavedQuery", savedQuerySchema);
