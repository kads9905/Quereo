import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank, intInRange } from "../utils/validate.js";
import { SavedQuery } from "../models/savedQuery.model.js";
import { QueryHistory } from "../models/queryHistory.model.js";
import {
  getOwnedConnection,
  runOnConnection,
  explainOnConnection,
  MAX_ANALYZE_MS,
} from "../services/connection.service.js";
import { buildVerdict, DEFAULT_SLOW_MS } from "../services/verdict.service.js";

const MAX_SQL_LENGTH = 20_000;
const MAX_HISTORY_SQL_LENGTH = 5_000;

const readSql = (sql) => {
  if (isBlank(sql)) throw new ApiError(400, "sql is required");
  if (sql.length > MAX_SQL_LENGTH) throw new ApiError(400, `sql must be under ${MAX_SQL_LENGTH} characters`);
  return sql.trim();
};

// POST /api/connections/:id/query  { sql, maxRows?, timeoutMs?, slowMs?, verdict? }
const runQuery = asyncHandler(async (req, res) => {
  const sql = readSql(req.body?.sql);
  const maxRows = intInRange(req.body?.maxRows, { min: 1, max: 5_000, fallback: 500, label: "maxRows" });
  const timeoutMs = intInRange(req.body?.timeoutMs, { min: 100, max: 120_000, fallback: 30_000, label: "timeoutMs" });
  const slowMs = intInRange(req.body?.slowMs, { min: 1, max: 600_000, fallback: DEFAULT_SLOW_MS, label: "slowMs" });

  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });

  const historyEntry = {
    user: req.user._id,
    connection: connection._id,
    sql: sql.slice(0, MAX_HISTORY_SQL_LENGTH),
  };

  let result;
  try {
    result = await runOnConnection(connection, sql, { maxRows, timeoutMs });
  } catch (error) {
    // Failed runs go into history too, so the user can see what went wrong
    await QueryHistory.create({ ...historyEntry, status: "error", error: error.message });
    throw error;
  }

  // The verdict needs the query plan. EXPLAIN ANALYZE runs the query a second
  // time, so it's skipped for slow queries (estimates are used instead).
  // A failed EXPLAIN never fails the run itself: the verdict just uses timing.
  let verdict = null;
  if (req.body?.verdict !== false) {
    let plan = null;
    try {
      plan = await explainOnConnection(connection, sql, {
        analyze: result.durationMs < MAX_ANALYZE_MS,
        timeoutMs,
      });
    } catch {
      plan = null;
    }
    verdict = buildVerdict({ sql, durationMs: result.durationMs, rowCount: result.rowCount, plan, slowMs, engine: connection.type });
  }

  await QueryHistory.create({
    ...historyEntry,
    status: "ok",
    durationMs: result.durationMs,
    rowCount: result.rowCount,
    verdict: verdict?.verdict,
  });

  return res.status(200).json(new ApiResponse(200, { ...result, verdict }, "Query executed"));
});

// GET /api/history?connectionId=&limit=&before=
// Cursor pagination: pass the createdAt of the last item as `before` to get the next page.
// Unlike skip/offset, this stays fast however far back you scroll.
const listHistory = asyncHandler(async (req, res) => {
  const limit = intInRange(req.query.limit, { min: 1, max: 100, fallback: 50, label: "limit" });
  const filter = { user: req.user._id };

  if (req.query.connectionId) {
    if (!mongoose.isValidObjectId(req.query.connectionId)) throw new ApiError(400, "Invalid connectionId");
    filter.connection = req.query.connectionId;
  }

  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) throw new ApiError(400, "before must be a date");
    filter.createdAt = { $lt: before };
  }

  const items = await QueryHistory.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = items.length > limit;
  const page = items.slice(0, limit);

  return res.status(200).json(
    new ApiResponse(200, {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].createdAt : null,
    }, "History fetched")
  );
});

const clearHistory = asyncHandler(async (req, res) => {
  const { deletedCount } = await QueryHistory.deleteMany({ user: req.user._id });
  return res.status(200).json(new ApiResponse(200, { deletedCount }, "History cleared"));
});

// ---- Saved queries ----

const listSavedQueries = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.connectionId) {
    if (!mongoose.isValidObjectId(req.query.connectionId)) throw new ApiError(400, "Invalid connectionId");
    filter.connection = req.query.connectionId;
  }

  const queries = await SavedQuery.find(filter).sort({ updatedAt: -1 });
  return res.status(200).json(new ApiResponse(200, queries, "Saved queries fetched"));
});

const createSavedQuery = asyncHandler(async (req, res) => {
  const { name, connectionId } = req.body || {};
  if (isBlank(name)) throw new ApiError(400, "name is required");

  // Confirms the connection exists and belongs to this user
  const connection = await getOwnedConnection(req.user._id, connectionId);

  const saved = await SavedQuery.create({
    user: req.user._id,
    connection: connection._id,
    name,
    sql: readSql(req.body.sql),
  });

  return res.status(201).json(new ApiResponse(201, saved, "Query saved"));
});

const getOwnedSavedQuery = async (userId, id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid saved query id");
  const saved = await SavedQuery.findOne({ _id: id, user: userId });
  if (!saved) throw new ApiError(404, "Saved query not found");
  return saved;
};

const updateSavedQuery = asyncHandler(async (req, res) => {
  const saved = await getOwnedSavedQuery(req.user._id, req.params.id);
  const { name, sql } = req.body || {};

  if (name !== undefined) {
    if (isBlank(name)) throw new ApiError(400, "name cannot be empty");
    saved.name = name;
  }
  if (sql !== undefined) saved.sql = readSql(sql);

  await saved.save();
  return res.status(200).json(new ApiResponse(200, saved, "Saved query updated"));
});

const deleteSavedQuery = asyncHandler(async (req, res) => {
  const saved = await getOwnedSavedQuery(req.user._id, req.params.id);
  await saved.deleteOne();
  return res.status(200).json(new ApiResponse(200, {}, "Saved query deleted"));
});

export {
  runQuery,
  listHistory,
  clearHistory,
  listSavedQueries,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
};
