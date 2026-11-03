import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank, intInRange } from "../utils/validate.js";
import { getAdapter } from "../adapters/index.js";
import { getOwnedConnection, toAdapterConfig, explainOnConnection, isReadQueryFor } from "../services/connection.service.js";
import { findTable } from "../services/schema.service.js";
import { buildIndexSuggestions, summarizeTrial } from "../services/advisor.service.js";

const readQuery = (connection, sql) => {
  if (isBlank(sql)) throw new ApiError(400, "sql is required");
  if (!isReadQueryFor(connection, sql)) throw new ApiError(400, "The Index Advisor works on read queries (SELECT, or find/aggregate/count on MongoDB)");
  return sql.trim();
};

// MongoDB field paths like "address.city": letters, digits, _ and dots, no leading $
const MONGO_FIELD_PATH = /^[A-Za-z_][\w]*(\.[\w]+)*$/;

// POST /api/connections/:id/advisor/suggest { sql }
// Runs EXPLAIN ANALYZE, finds full table scans, and suggests an index for each.
const suggestIndexes = asyncHandler(async (req, res) => {
  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const sql = readQuery(connection, req.body?.sql);
  const adapter = getAdapter(connection.type);

  const [plan, schema] = await Promise.all([
    explainOnConnection(connection, sql, { analyze: true }),
    adapter.getSchema(connection, toAdapterConfig(connection)),
  ]);

  const suggestions = buildIndexSuggestions(plan, schema, adapter);

  return res.status(200).json(
    new ApiResponse(200, {
      queryTimeMs: plan.totalTimeMs,
      suggestions,
      message: suggestions.length
        ? `Found ${suggestions.length} index suggestion(s)`
        : "No full table scans with a filter, so no index would help this query",
    }, "Index suggestions")
  );
});

// POST /api/connections/:id/advisor/try { sql, table, columns }
// The proof: measures the query, adds the index, measures again, removes the index.
const tryIndex = asyncHandler(async (req, res) => {
  const { table: tableName, columns } = req.body || {};
  const timeoutMs = intInRange(req.body?.timeoutMs, { min: 1_000, max: 120_000, fallback: 60_000, label: "timeoutMs" });

  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const sql = readQuery(connection, req.body?.sql);
  if (connection.readOnly) {
    throw new ApiError(400, "Index trials create a temporary index, so they need a connection with read-only turned off. Use a dev or staging database.");
  }

  const adapter = getAdapter(connection.type);
  const config = toAdapterConfig(connection);

  // Only real tables and columns are accepted, so nothing in the request reaches SQL unchecked
  const schema = await adapter.getSchema(connection, config);
  const table = isBlank(tableName) ? null : findTable(schema, tableName);
  if (!table) throw new ApiError(400, `Table not found: ${tableName}`);

  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 5 || new Set(columns).size !== columns.length) {
    throw new ApiError(400, "columns must be a list of 1 to 5 different column names");
  }
  // A MongoDB schema is only inferred from sample documents, so a real field can
  // be missing from it; field paths are checked for a safe shape instead
  const unknown = schema.inferred
    ? columns.filter((column) => typeof column !== "string" || !MONGO_FIELD_PATH.test(column))
    : columns.filter((column) => !table.columns[column]);
  if (unknown.length) throw new ApiError(400, `Unknown column(s) on ${table.name}: ${unknown.join(", ")}`);

  const trial = await adapter.tryIndex(connection, config, {
    sql,
    schema: table.schema,
    table: table.name,
    columns,
    timeoutMs,
  });

  return res.status(200).json(
    new ApiResponse(200, {
      table: table.name,
      columns,
      ...summarizeTrial(trial),
      statement: adapter.createIndexStatement({
        schema: table.schema,
        table: table.name,
        columns,
        indexName: `idx_${table.name}_${columns.join("_")}`.toLowerCase().slice(0, 63),
      }),
      indexKept: false,
    }, "Index trial finished")
  );
});

// GET /api/connections/:id/advisor/unused-indexes
// Indexes that are never read still cost disk space and slow down every write.
// Primary keys and unique indexes are left out: they enforce rules, not just speed.
const getUnusedIndexes = asyncHandler(async (req, res) => {
  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const usage = await getAdapter(connection.type).getIndexUsage(connection, toAdapterConfig(connection));

  const unused = usage.indexes
    .filter((index) => index.scans === 0 && !index.primary && !index.unique)
    .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));

  return res.status(200).json(
    new ApiResponse(200, {
      statsSince: usage.statsSince,
      totalIndexes: usage.indexes.length,
      unused,
      wastedBytes: unused.reduce((total, index) => total + (index.sizeBytes || 0), 0),
      note:
        "Usage counts start when database statistics were last reset. Check that this covers a normal period of traffic before dropping anything." +
        (connection.type === "mysql"
          ? " MySQL also counts its own maintenance reads (ANALYZE TABLE, unique checks on insert), so some unused indexes can look used until the counters are reset."
          : ""),
    }, "Unused indexes")
  );
});

export { suggestIndexes, tryIndex, getUnusedIndexes };
