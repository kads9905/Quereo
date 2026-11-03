// Turns a query's timing + plan into a verdict: PASS, WARN or SLOW.
//
// Every adapter converts its database's plan into the same node format:
//   { operation, table, fullScan, filter, rowsExamined, rowsReturned,
//     estimatedRows, actualRows, sortOnDisk, estimated }
// so these rules are written once and work for every database type.

const DEFAULT_SLOW_MS = 200;
// Scanning a small table is normal and often faster than using an index
const LARGE_SCAN_ROWS = 10_000;
const LARGE_RESULT_ROWS = 1_000;
// Planner estimate off by this factor or more = statistics are probably stale
const ESTIMATE_OFF_FACTOR = 10;
const ESTIMATE_MIN_ROWS = 1_000;

const formatCount = (n) => Math.round(n).toLocaleString("en-US");

const checkSpeed = (durationMs, slowMs) => ({
  name: `Runs in under ${slowMs} ms`,
  passed: durationMs <= slowMs,
  issues:
    durationMs > slowMs
      ? [{
          rule: "slow_query",
          severity: "slow",
          message: `Took ${formatCount(durationMs)} ms, over the ${slowMs} ms limit`,
          suggestion: "Check the other findings below for the cause",
        }]
      : [],
});

const checkFullScans = (nodes) => {
  const issues = nodes
    .filter((node) => node.fullScan && node.filter && node.rowsExamined >= LARGE_SCAN_ROWS)
    .map((node) => {
      const approx = node.estimated || node.approximate ? "~" : "";
      const returned = node.rowsReturned != null && !node.estimated
        ? ` to return ${approx}${formatCount(node.rowsReturned)}`
        : "";
      return {
        rule: "full_table_scan",
        severity: "warn",
        table: node.table,
        message: `Full table scan on ${node.table}: read ${approx}${formatCount(node.rowsExamined)} rows${returned}`,
        filter: node.filter,
        suggestion: `An index on the column(s) in ${node.filter} would let the database jump straight to matching rows`,
      };
    });

  return { name: "No full scans of large tables", passed: issues.length === 0, issues };
};

const checkSortSpill = (nodes) => {
  const issues = nodes
    .filter((node) => node.sortOnDisk)
    .map(() => ({
      rule: "sort_on_disk",
      severity: "warn",
      message: "A sort was too big for memory and spilled to disk",
      suggestion: "Add an index that matches the ORDER BY, or sort fewer rows (filter first, add LIMIT)",
    }));

  return { name: "Sorts fit in memory", passed: issues.length === 0, issues };
};

const checkEstimates = (nodes) => {
  const issues = nodes
    .filter((node) => node.table && node.actualRows != null && node.estimatedRows != null)
    .filter((node) => {
      const high = Math.max(node.actualRows, node.estimatedRows);
      const low = Math.max(Math.min(node.actualRows, node.estimatedRows), 1);
      return high >= ESTIMATE_MIN_ROWS && high / low >= ESTIMATE_OFF_FACTOR;
    })
    .map((node) => ({
      rule: "stale_statistics",
      severity: "warn",
      table: node.table,
      message: `Expected ${formatCount(node.estimatedRows)} rows from ${node.table} but got ${formatCount(node.actualRows)}`,
      suggestion: `Statistics look out of date. Run ANALYZE on ${node.table} so the planner picks better plans`,
    }));

  return { name: "Row estimates are accurate", passed: issues.length === 0, issues };
};

// Tips are good practice, but don't count as failed checks
const collectTips = (sql, rowCount) => {
  const tips = [];

  if (/\bselect\s+\*/i.test(sql)) {
    tips.push({
      rule: "select_star",
      severity: "info",
      message: "SELECT * reads every column",
      suggestion: "Select only the columns you need, so less data is read and sent",
    });
  }

  if (rowCount > LARGE_RESULT_ROWS && !/\blimit\b/i.test(sql)) {
    tips.push({
      rule: "large_result",
      severity: "info",
      message: `Returned ${formatCount(rowCount)} rows without a LIMIT`,
      suggestion: "Add LIMIT or paginate if you don't need every row",
    });
  }

  return tips;
};

// durationMs: how long the query took (null if unknown, e.g. a plain EXPLAIN)
// plan: normalized plan from an adapter, or null if no plan was available
const buildVerdict = ({ sql, durationMs, rowCount = 0, plan, slowMs = DEFAULT_SLOW_MS, engine }) => {
  const nodes = plan?.nodes || [];
  const checks = [];

  if (durationMs != null) checks.push(checkSpeed(durationMs, slowMs));
  if (plan) {
    checks.push(checkFullScans(nodes));
    // Only Postgres reports disk sorts in its plan
    if (engine === "postgres" && plan.analyzed) checks.push(checkSortSpill(nodes));
    if (plan.analyzed) checks.push(checkEstimates(nodes));
  }

  const issues = checks.flatMap((check) => check.issues);
  const passedChecks = checks.filter((check) => check.passed).length;

  let verdict = "PASS";
  if (issues.some((issue) => issue.severity === "slow")) verdict = "SLOW";
  else if (issues.length) verdict = "WARN";

  return {
    verdict,
    summary: `${passedChecks} of ${checks.length} checks passed`,
    durationMs,
    slowMs,
    planAvailable: Boolean(plan),
    checks: checks.map(({ name, passed }) => ({ name, passed })),
    issues,
    tips: collectTips(sql, rowCount),
  };
};

export { buildVerdict, DEFAULT_SLOW_MS };
