import mongoose, { Schema } from "mongoose";

// Opened when a monitor keeps failing, resolved when it passes again
const incidentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  monitor: { type: Schema.Types.ObjectId, ref: "Monitor", required: true },
  status: { type: String, enum: ["open", "resolved"], default: "open" },
  // Why it opened, e.g. "value 142 is not < 100" or the database error
  reason: { type: String, required: true },
  failureCount: { type: Number, default: 1 },
  openedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  // Delivery result of the last webhook alert, so failures are visible
  lastAlert: {
    event: String,
    ok: Boolean,
    error: String,
    sentAt: Date,
  },
});

incidentSchema.index({ user: 1, status: 1, openedAt: -1 });
// At most one open incident per monitor (enforced by the database, not just our code)
incidentSchema.index(
  { monitor: 1 },
  { unique: true, partialFilterExpression: { status: "open" } }
);

export const Incident = mongoose.model("Incident", incidentSchema);
