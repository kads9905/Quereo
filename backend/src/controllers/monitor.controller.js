import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank, intInRange } from "../utils/validate.js";
import { Monitor, CHECK_TYPES, OPERATORS } from "../models/monitor.model.js";
import { MonitorRun } from "../models/monitorRun.model.js";
import { Incident } from "../models/incident.model.js";
import { getOwnedConnection, isReadQueryFor } from "../services/connection.service.js";
import { runMonitor } from "../services/monitor.service.js";
import { sendAlert } from "../services/alert.service.js";

const DEFAULT_INTERVAL_SECONDS = 300;

const isValidWebhook = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// Validates monitor fields. On update (`existing` given) every field is optional.
const readMonitorBody = (body = {}, existing) => {
  const fields = {};
  const has = (key) => body[key] !== undefined;

  if (has("name") || !existing) {
    if (isBlank(body.name)) throw new ApiError(400, "name is required");
    fields.name = body.name.trim();
  }

  if (has("sql") || !existing) {
    if (isBlank(body.sql)) throw new ApiError(400, "sql is required");
    fields.sql = body.sql.trim();
  }

  if (has("check") || !existing) {
    const { type, operator, threshold } = body.check || {};
    if (!CHECK_TYPES.includes(type)) throw new ApiError(400, `check.type must be one of: ${CHECK_TYPES.join(", ")}`);
    if (!OPERATORS.includes(operator)) throw new ApiError(400, `check.operator must be one of: ${OPERATORS.join(" ")}`);
    if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
      throw new ApiError(400, "check.threshold must be a number");
    }
    fields.check = { type, operator, threshold };
  }

  if (has("intervalSeconds") || !existing) {
    fields.intervalSeconds = intInRange(body.intervalSeconds, {
      min: 60, max: 86_400, fallback: DEFAULT_INTERVAL_SECONDS, label: "intervalSeconds",
    });
  }

  if (has("alertAfter")) {
    fields.alertAfter = intInRange(body.alertAfter, { min: 1, max: 10, fallback: 1, label: "alertAfter" });
  }

  if (has("webhookUrl")) {
    // Empty string removes the webhook
    if (body.webhookUrl && !isValidWebhook(body.webhookUrl)) {
      throw new ApiError(400, "webhookUrl must be an http(s) URL");
    }
    fields.webhookUrl = body.webhookUrl || undefined;
  }

  if (has("enabled")) fields.enabled = Boolean(body.enabled);

  return fields;
};

// Monitors run unattended on a schedule, so they may only read.
// What counts as a read depends on the connection's query language.
const assertReadQuery = (connection, text) => {
  if (!isReadQueryFor(connection, text)) {
    throw new ApiError(400, "Monitors can only run read queries");
  }
};

const getOwnedMonitor = async (userId, id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid monitor id");
  const monitor = await Monitor.findOne({ _id: id, user: userId });
  if (!monitor) throw new ApiError(404, "Monitor not found");
  return monitor;
};

// POST /api/monitors
// Saves the monitor and runs it once right away, so the user immediately
// sees whether the query works and what value it returns.
const createMonitor = asyncHandler(async (req, res) => {
  const fields = readMonitorBody(req.body);
  const connection = await getOwnedConnection(req.user._id, req.body?.connectionId);
  assertReadQuery(connection, fields.sql);

  const monitor = await Monitor.create({
    ...fields,
    user: req.user._id,
    connection: connection._id,
    nextRunAt: new Date(Date.now() + fields.intervalSeconds * 1000),
  });

  const { run, monitor: updated, incident } = await runMonitor(monitor);

  return res.status(201).json(new ApiResponse(201, { monitor: updated, firstRun: run, incident }, "Monitor created"));
});

const listMonitors = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.connectionId) {
    if (!mongoose.isValidObjectId(req.query.connectionId)) throw new ApiError(400, "Invalid connectionId");
    filter.connection = req.query.connectionId;
  }

  const [monitors, openIncidents] = await Promise.all([
    Monitor.find(filter).sort({ createdAt: -1 }),
    Incident.find({ user: req.user._id, status: "open" }).select("monitor"),
  ]);

  const withOpenIncident = new Set(openIncidents.map((incident) => String(incident.monitor)));
  const items = monitors.map((monitor) => ({
    ...monitor.toJSON(),
    hasOpenIncident: withOpenIncident.has(String(monitor._id)),
  }));

  return res.status(200).json(new ApiResponse(200, items, "Monitors fetched"));
});

const getMonitor = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);
  const [recentRuns, openIncident] = await Promise.all([
    MonitorRun.find({ monitor: monitor._id }).sort({ ranAt: -1 }).limit(20),
    Incident.findOne({ monitor: monitor._id, status: "open" }),
  ]);

  return res.status(200).json(new ApiResponse(200, { monitor, recentRuns, openIncident }, "Monitor fetched"));
});

const updateMonitor = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);
  const fields = readMonitorBody(req.body, monitor);
  if (fields.sql !== undefined) {
    assertReadQuery(await getOwnedConnection(req.user._id, monitor.connection), fields.sql);
  }

  const wasEnabled = monitor.enabled;
  const ruleChanged = fields.sql !== undefined || fields.check !== undefined;
  Object.assign(monitor, fields);

  // New query or rule: previous results no longer mean anything
  if (ruleChanged) {
    monitor.status = "pending";
    monitor.consecutiveFailures = 0;
  }
  // Turned back on, or rule changed: check soon instead of waiting a full interval
  if ((!wasEnabled && monitor.enabled) || ruleChanged) {
    monitor.nextRunAt = new Date();
  } else if (fields.intervalSeconds !== undefined) {
    monitor.nextRunAt = new Date(Date.now() + monitor.intervalSeconds * 1000);
  }

  await monitor.save();
  return res.status(200).json(new ApiResponse(200, monitor, "Monitor updated"));
});

const deleteMonitor = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);

  await Promise.all([
    MonitorRun.deleteMany({ monitor: monitor._id }),
    Incident.deleteMany({ monitor: monitor._id }),
    monitor.deleteOne(),
  ]);

  return res.status(200).json(new ApiResponse(200, {}, "Monitor deleted"));
});

// POST /api/monitors/:id/run - run now, outside the schedule
const runMonitorNow = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);
  const result = await runMonitor(monitor);

  return res.status(200).json(new ApiResponse(200, result, "Monitor ran"));
});

// POST /api/monitors/:id/test-alert - checks the webhook works before a real incident
const sendTestAlert = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);
  if (!monitor.webhookUrl) throw new ApiError(400, "This monitor has no webhookUrl");

  const result = await sendAlert(monitor, null, "test");
  if (!result.ok) throw new ApiError(400, `Alert failed: ${result.error}`);

  return res.status(200).json(new ApiResponse(200, result, "Test alert sent"));
});

// GET /api/monitors/:id/runs?limit=&before=  (cursor pagination, newest first)
const listRuns = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);
  const limit = intInRange(req.query.limit, { min: 1, max: 200, fallback: 50, label: "limit" });

  const filter = { monitor: monitor._id };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) throw new ApiError(400, "before must be a date");
    filter.ranAt = { $lt: before };
  }

  const runs = await MonitorRun.find(filter).sort({ ranAt: -1 }).limit(limit + 1).lean();
  const page = runs.slice(0, limit);

  return res.status(200).json(
    new ApiResponse(200, {
      items: page,
      nextCursor: runs.length > limit ? page[page.length - 1].ranAt : null,
    }, "Runs fetched")
  );
});

const STATS_WINDOWS = {
  "24h": { ms: 24 * 60 * 60 * 1000, bucket: "hour" },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, bucket: "day" },
  "30d": { ms: 30 * 24 * 60 * 60 * 1000, bucket: "day" },
};

const round = (value, digits = 2) => (value == null ? null : Number(value.toFixed(digits)));

// GET /api/monitors/:id/stats?window=24h|7d|30d
// Uptime and latency are calculated inside MongoDB with an aggregation,
// so we never load thousands of runs into the server's memory.
const getMonitorStats = asyncHandler(async (req, res) => {
  const monitor = await getOwnedMonitor(req.user._id, req.params.id);
  const windowKey = req.query.window || "24h";
  const window = STATS_WINDOWS[windowKey];
  if (!window) throw new ApiError(400, `window must be one of: ${Object.keys(STATS_WINDOWS).join(", ")}`);

  const since = new Date(Date.now() - window.ms);
  const match = { $match: { monitor: monitor._id, ranAt: { $gte: since } } };

  const [summary] = await MonitorRun.aggregate([
    match,
    {
      $group: {
        _id: null,
        totalRuns: { $sum: 1 },
        passedRuns: { $sum: { $cond: ["$passed", 1, 0] } },
        avgMs: { $avg: "$durationMs" },
        maxMs: { $max: "$durationMs" },
        percentiles: { $percentile: { input: "$durationMs", p: [0.5, 0.95], method: "approximate" } },
      },
    },
  ]);

  // One point per hour (24h) or per day (7d/30d), for an uptime/latency chart
  const series = await MonitorRun.aggregate([
    match,
    {
      $group: {
        _id: { $dateTrunc: { date: "$ranAt", unit: window.bucket } },
        runs: { $sum: 1 },
        passed: { $sum: { $cond: ["$passed", 1, 0] } },
        avgMs: { $avg: "$durationMs" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const incidents = await Incident.countDocuments({ monitor: monitor._id, openedAt: { $gte: since } });

  const totalRuns = summary?.totalRuns || 0;

  return res.status(200).json(
    new ApiResponse(200, {
      window: windowKey,
      totalRuns,
      failedRuns: totalRuns - (summary?.passedRuns || 0),
      uptimePct: totalRuns ? round((summary.passedRuns / totalRuns) * 100) : null,
      avgMs: round(summary?.avgMs),
      p50Ms: round(summary?.percentiles?.[0]),
      p95Ms: round(summary?.percentiles?.[1]),
      maxMs: round(summary?.maxMs),
      incidents,
      series: series.map((point) => ({
        time: point._id,
        runs: point.runs,
        uptimePct: round((point.passed / point.runs) * 100),
        avgMs: round(point.avgMs),
      })),
    }, "Monitor stats")
  );
});

// GET /api/incidents?status=open|resolved&limit=
const listIncidents = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.status) {
    if (!["open", "resolved"].includes(req.query.status)) throw new ApiError(400, "status must be open or resolved");
    filter.status = req.query.status;
  }
  const limit = intInRange(req.query.limit, { min: 1, max: 100, fallback: 50, label: "limit" });

  const incidents = await Incident.find(filter)
    .sort({ openedAt: -1 })
    .limit(limit)
    .populate("monitor", "name connection");

  return res.status(200).json(new ApiResponse(200, incidents, "Incidents fetched"));
});

export {
  createMonitor,
  listMonitors,
  getMonitor,
  updateMonitor,
  deleteMonitor,
  runMonitorNow,
  sendTestAlert,
  listRuns,
  getMonitorStats,
  listIncidents,
};
