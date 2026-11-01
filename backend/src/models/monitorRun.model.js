import mongoose, { Schema } from "mongoose";

const RUN_RETENTION_DAYS = 90;

// One document per scheduled (or manual) run of a monitor
const monitorRunSchema = new Schema({
  monitor: { type: Schema.Types.ObjectId, ref: "Monitor", required: true },
  passed: { type: Boolean, required: true },
  // The measured value (row count, first value, or ms), null if the query failed
  value: Number,
  durationMs: Number,
  error: String,
  ranAt: { type: Date, default: Date.now },
});

// Runs are always read per monitor, newest first, often within a time window
monitorRunSchema.index({ monitor: 1, ranAt: -1 });

// MongoDB deletes runs older than 90 days automatically
monitorRunSchema.index({ ranAt: 1 }, { expireAfterSeconds: RUN_RETENTION_DAYS * 24 * 60 * 60 });

export const MonitorRun = mongoose.model("MonitorRun", monitorRunSchema);
