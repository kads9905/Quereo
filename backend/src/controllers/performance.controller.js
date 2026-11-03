import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank, intInRange } from "../utils/validate.js";
import { getAdapter } from "../adapters/index.js";
import { getOwnedConnection, toAdapterConfig, explainOnConnection } from "../services/connection.service.js";
import { buildVerdict, DEFAULT_SLOW_MS } from "../services/verdict.service.js";

// POST /api/connections/:id/explain  { sql, analyze? }
// Returns the full plan (for a visual plan tree) plus the verdict, without the rows.
const explainQuery = asyncHandler(async (req, res) => {
  const { sql, analyze = true } = req.body || {};
  if (isBlank(sql)) throw new ApiError(400, "sql is required");

  const slowMs = intInRange(req.body?.slowMs, { min: 1, max: 600_000, fallback: DEFAULT_SLOW_MS, label: "slowMs" });
  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });

  const plan = await explainOnConnection(connection, sql.trim(), { analyze: Boolean(analyze) });
  if (!plan) {
    throw new ApiError(400, "This statement can't be explained. Use SELECT/INSERT/UPDATE/DELETE, or find/aggregate/count/distinct/update/delete on MongoDB");
  }

  const verdict = buildVerdict({
    sql,
    durationMs: plan.analyzed ? plan.totalTimeMs : null,
    plan,
    slowMs,
    engine: connection.type,
  });

  return res.status(200).json(new ApiResponse(200, { plan, verdict }, "Query explained"));
});

const SORT_OPTIONS = ["total", "mean", "calls"];

// GET /api/connections/:id/slow-queries?sortBy=total|mean|calls&limit=20&slowMs=200
//   total: queries using the most time overall (best place to start optimizing)
//   mean:  the slowest queries per run
//   calls: the most frequently run queries
const getSlowQueries = asyncHandler(async (req, res) => {
  const sortBy = req.query.sortBy || "total";
  if (!SORT_OPTIONS.includes(sortBy)) {
    throw new ApiError(400, `sortBy must be one of: ${SORT_OPTIONS.join(", ")}`);
  }
  const limit = intInRange(req.query.limit, { min: 1, max: 100, fallback: 20, label: "limit" });
  const slowMs = intInRange(req.query.slowMs, { min: 1, max: 600_000, fallback: DEFAULT_SLOW_MS, label: "slowMs" });

  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const queries = await getAdapter(connection.type).getSlowQueries(connection, toAdapterConfig(connection), {
    sortBy,
    limit,
  });

  const items = queries.map((query) => ({ ...query, slow: query.meanMs > slowMs }));

  return res.status(200).json(new ApiResponse(200, { sortBy, slowMs, items }, "Slow queries fetched"));
});

export { explainQuery, getSlowQueries };
