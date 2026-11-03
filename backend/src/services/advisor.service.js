import { findTable } from "./schema.service.js";

// Columns used with these operators go FIRST in an index: an index on
// (customer_id, created_at) can jump to customer_id = 42 and then read a
// date range inside it. Range columns go last, because after a range the
// index can't narrow the rows any further.
const EQUALITY_OPERATORS = new Set(["=", "IN", "IS"]);
// "!=" matches almost every row, so an index can't help with it
const USELESS_OPERATORS = new Set(["<>", "!="]);
const MAX_INDEX_COLUMNS = 3;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Finds which of the table's columns a plan filter uses, and how.
// Works on both Postgres filters:  ((status)::text = 'paid'::text) AND (customer_id = 42)
// and MySQL conditions:            ((o.customer_id = 42) and (o.created_at > ...))
const extractFilterColumns = (filter, columnNames) => {
  // Remove string literals first, so 'paid' or 'customer_id' inside quotes can't match
  const text = filter.replace(/'(?:[^']|'')*'/g, "''");
  const found = [];

  for (const column of columnNames) {
    const name = `[\`"]?${escapeRegex(column)}[\`"]?`;
    // column, then optional ")" and "::type" casts, then the operator
    const pattern = new RegExp(
      `(?<![\\w$])${name}(?![\\w$])(?:\\)|::[\\w ]+|\\s)*?\\s*(=|<>|!=|<=|>=|<|>|~~\\*?|!~~|\\bLIKE\\b|\\bIN\\b|\\bIS\\b|\\bBETWEEN\\b)`,
      "i"
    );
    const match = pattern.exec(text);
    if (!match) continue;

    const operator = match[1].toUpperCase();
    if (USELESS_OPERATORS.has(operator)) continue;

    found.push({
      column,
      position: match.index,
      kind: EQUALITY_OPERATORS.has(operator) ? "equality" : "range",
    });
  }

  return found.sort((a, b) => a.position - b.position);
};

// Equality columns first (in the order they appear), then at most one range column
const orderIndexColumns = (filterColumns) => {
  const equality = filterColumns.filter((c) => c.kind === "equality").map((c) => c.column);
  const range = filterColumns.filter((c) => c.kind === "range").map((c) => c.column);
  return [...equality, ...range.slice(0, 1)].slice(0, MAX_INDEX_COLUMNS);
};

const indexNameFor = (table, columns) => `idx_${table}_${columns.join("_")}`.toLowerCase().slice(0, 63);

// Turns full table scans in a plan into concrete CREATE INDEX suggestions
const buildIndexSuggestions = (plan, schema, adapter) => {
  const suggestions = [];
  const seen = new Set();

  for (const node of plan.nodes) {
    if (!node.fullScan || !node.table || !node.filter) continue;

    const table = findTable(schema, node.table);
    if (!table) continue;

    // MongoDB plans give the filter as a document, so its adapter already
    // extracted the fields; SQL filters are text and get parsed here
    const filterColumns = node.filterFields ?? extractFilterColumns(node.filter, Object.keys(table.columns));
    const columns = orderIndexColumns(filterColumns);
    if (!columns.length) continue;

    const key = `${table.schema}.${table.name}:${columns.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // An index that already starts with these columns exists, but wasn't used
    const existing = Object.entries(table.indexes).find(([, index]) =>
      columns.every((column, i) => index.columns[i] === column)
    );

    const indexName = indexNameFor(table.name, columns);
    suggestions.push({
      table: table.name,
      schema: table.schema,
      columns,
      filter: node.filter,
      rowsExamined: node.rowsExamined,
      rowsReturned: node.rowsReturned,
      reason: `Full scan of ${table.name} to filter on ${columns.join(", ")}`,
      existingIndex: existing?.[0] || null,
      statement: existing
        ? null
        : adapter.createIndexStatement({ schema: table.schema, table: table.name, columns, indexName }),
      note: existing
        ? `Index ${existing[0]} already covers these columns but wasn't used. The filter probably matches too many rows for an index to help.`
        : null,
    });
  }

  return suggestions;
};

const sumRowsExamined = (plan) =>
  plan.nodes.filter((node) => node.table).reduce((total, node) => total + (node.rowsExamined || 0), 0);

// Compares the before/after plans from an index trial
const summarizeTrial = ({ before, after, indexName }) => {
  const beforeMs = before.totalTimeMs;
  const afterMs = after.totalTimeMs;
  const indexUsed = after.nodes.some((node) => node.indexName === indexName);

  // Some databases (MongoDB) time queries in whole milliseconds, so a fast
  // indexed query can measure 0 ms. Then the speed-up is "at least" before/1ms.
  const belowResolution = afterMs === 0;
  const speedup = belowResolution
    ? Math.round(beforeMs)
    : Math.round((beforeMs / afterMs) * 10) / 10;

  let verdict = "not_used";
  if (indexUsed) verdict = speedup >= 2 ? "recommended" : "small_gain";

  // Index lookups often take well under 1 ms, so small times keep more decimals
  const ms = (value) => {
    if (value === 0) return "under 1 ms";
    return `${value < 1 ? value.toFixed(3) : value.toFixed(1)} ms`;
  };

  const messages = {
    recommended: `${belowResolution ? "At least " : ""}${speedup}x faster: ${ms(beforeMs)} → ${ms(afterMs)}`,
    small_gain: `Only ${speedup}x faster (${ms(beforeMs)} → ${ms(afterMs)}). Probably not worth the extra write cost.`,
    not_used: "The database didn't use the index for this query, so it wouldn't help",
  };

  return {
    verdict,
    message: messages[verdict],
    indexUsed,
    speedup,
    speedupIsMinimum: belowResolution,
    before: { timeMs: beforeMs, rowsExamined: sumRowsExamined(before) },
    after: { timeMs: afterMs, rowsExamined: sumRowsExamined(after) },
  };
};

export { extractFilterColumns, orderIndexColumns, buildIndexSuggestions, summarizeTrial };
