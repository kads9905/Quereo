import { Connection } from "../models/connection.model.js";
import { Monitor } from "../models/monitor.model.js";
import { MonitorRun } from "../models/monitorRun.model.js";
import { Incident } from "../models/incident.model.js";
import { runOnConnection } from "./connection.service.js";
import { sendAlert } from "./alert.service.js";

const MONITOR_TIMEOUT_MS = 15_000;
const ROW_COUNT_LIMIT = 10_000;

const COMPARE = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

const CHECK_LABELS = {
  row_count: "row count",
  value: "value",
  duration: "duration (ms)",
};

// Turns a query result into the one number the check compares
const measure = (checkType, result) => {
  if (checkType === "row_count") return result.rowCount;
  if (checkType === "duration") return result.durationMs;

  if (!result.rows.length) throw new Error("Query returned no rows, expected a number in the first column");
  const value = Number(result.rows[0][0]);
  if (result.rows[0][0] === null || Number.isNaN(value)) {
    throw new Error(`First column is not a number: ${JSON.stringify(result.rows[0][0])}`);
  }
  return value;
};

// Runs one monitor once: query -> measure -> compare -> save the run ->
// update the monitor -> open/resolve an incident (and alert) if needed.
const runMonitor = async (monitor) => {
  const connection = await Connection.findById(monitor.connection).select("+passwordEnc");

  let value = null;
  let durationMs = null;
  let error = null;

  if (!connection) {
    error = "The connection for this monitor was deleted";
  } else {
    try {
      // Monitors only ever read, whatever the connection's own setting is
      const result = await runOnConnection(connection, monitor.sql, {
        readOnly: true,
        timeoutMs: MONITOR_TIMEOUT_MS,
        // Only the first row is needed, except for row counts: SQL databases
        // always report the full count, but MongoDB counts the documents fetched
        maxRows: monitor.check.type === "row_count" ? ROW_COUNT_LIMIT : 1,
      });
      durationMs = result.durationMs;
      value = measure(monitor.check.type, result);
    } catch (err) {
      error = err.message;
    }
  }

  const { type, operator, threshold } = monitor.check;
  const passed = error === null && COMPARE[operator](value, threshold);
  const reason = error ?? (passed ? null : `${CHECK_LABELS[type]} ${value} is not ${operator} ${threshold}`);

  const run = await MonitorRun.create({
    monitor: monitor._id,
    passed,
    value,
    durationMs,
    error: reason ?? undefined,
  });

  const consecutiveFailures = passed ? 0 : (monitor.consecutiveFailures || 0) + 1;

  const updated = await Monitor.findByIdAndUpdate(
    monitor._id,
    {
      $set: {
        status: passed ? "passing" : "failing",
        lastRunAt: run.ranAt,
        lastValue: value,
        lastError: reason,
        consecutiveFailures,
        lockedUntil: null,
      },
    },
    { returnDocument: "after" }
  );

  const incident = await updateIncident(updated || monitor, { passed, reason, consecutiveFailures });

  return { run, monitor: updated, incident };
};

const updateIncident = async (monitor, { passed, reason, consecutiveFailures }) => {
  if (passed) {
    const resolved = await Incident.findOneAndUpdate(
      { monitor: monitor._id, status: "open" },
      { $set: { status: "resolved", resolvedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (resolved) await sendAlert(monitor, resolved, "resolved");
    return resolved;
  }

  if (consecutiveFailures < monitor.alertAfter) return null;

  // Already open: just count the failure, don't alert again
  const existing = await Incident.findOneAndUpdate(
    { monitor: monitor._id, status: "open" },
    { $inc: { failureCount: 1 } },
    { returnDocument: "after" }
  );
  if (existing) return existing;

  try {
    const incident = await Incident.create({
      user: monitor.user,
      monitor: monitor._id,
      reason,
      failureCount: consecutiveFailures,
    });
    await sendAlert(monitor, incident, "opened");
    return incident;
  } catch (err) {
    // Another run opened it at the same moment (unique index on open incidents)
    if (err.code === 11000) return Incident.findOne({ monitor: monitor._id, status: "open" });
    throw err;
  }
};

export { runMonitor, MONITOR_TIMEOUT_MS };
