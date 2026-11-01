import mongoose, { Schema } from "mongoose";

const HISTORY_RETENTION_DAYS = 90;

// One document per query run from the workspace
const queryHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    connection: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    sql: { type: String, required: true },
    status: { type: String, enum: ["ok", "error"], required: true },
    durationMs: Number,
    rowCount: Number,
    verdict: String,
    error: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Newest-first listing per user (and optionally per connection)
queryHistorySchema.index({ user: 1, createdAt: -1 });
queryHistorySchema.index({ user: 1, connection: 1, createdAt: -1 });

// MongoDB deletes old history automatically (TTL index)
queryHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: HISTORY_RETENTION_DAYS * 24 * 60 * 60 }
);

export const QueryHistory = mongoose.model("QueryHistory", queryHistorySchema);
