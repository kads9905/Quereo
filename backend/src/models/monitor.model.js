import mongoose, { Schema } from "mongoose";

const CHECK_TYPES = ["row_count", "value", "duration"];
const OPERATORS = ["<", "<=", ">", ">=", "==", "!="];

// A saved query that runs on a schedule and must satisfy a rule, e.g.
// "SELECT count(*) FROM orders WHERE status = 'failed'" must be < 10, every 5 minutes.
const monitorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    connection: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    sql: { type: String, required: true, maxlength: 20_000 },

    // What to measure and the rule it must pass:
    //   row_count: number of rows returned
    //   value:     first column of the first row (e.g. a count(*))
    //   duration:  how long the query took, in ms
    check: {
      type: { type: String, enum: CHECK_TYPES, required: true },
      operator: { type: String, enum: OPERATORS, required: true },
      threshold: { type: Number, required: true },
    },

    intervalSeconds: { type: Number, required: true, min: 60, max: 86_400 },
    // Open an incident only after this many failures in a row, so one
    // blip (a network hiccup, a slow moment) doesn't wake anybody up
    alertAfter: { type: Number, default: 1, min: 1, max: 10 },
    // Slack-compatible incoming webhook (Discord works too)
    webhookUrl: { type: String, trim: true },
    enabled: { type: Boolean, default: true },

    status: { type: String, enum: ["pending", "passing", "failing"], default: "pending" },
    lastRunAt: Date,
    lastValue: Number,
    lastError: String,
    consecutiveFailures: { type: Number, default: 0 },

    // Scheduling: the scheduler picks monitors whose nextRunAt has passed.
    // lockedUntil marks a monitor as "being run right now", so two server
    // instances never run the same check twice.
    nextRunAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.lockedUntil;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// The scheduler's query: enabled monitors that are due
monitorSchema.index({ enabled: 1, nextRunAt: 1 });

export const Monitor = mongoose.model("Monitor", monitorSchema);
export { CHECK_TYPES, OPERATORS };
