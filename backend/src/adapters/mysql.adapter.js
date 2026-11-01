import mysql from "mysql2/promise";
import { createPoolCache } from "./poolCache.js";
import { getCommand, isReadCommand, sqlReadProblem, canExplainSql, queryError, connectError, timed } from "./utils.js";

const CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH",
  "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "PROTOCOL_CONNECTION_LOST",
]);

const toMysqlConfig = (config) => ({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.username,
  password: config.password,
  ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  connectTimeout: 5_000,
  // BIGINT/DECIMAL as strings, so large numbers never lose precision in JSON
  supportBigNumbers: true,
  bigNumberStrings: true,
  // Never allow "SELECT 1; DROP TABLE x" (this is the default, set explicitly on purpose)
  multipleStatements: false,
});

const pools = createPoolCache({
  create: (config) => mysql.createPool({ ...toMysqlConfig(config), connectionLimit: 3, maxIdle: 3, idleTimeout: 30_000 }),
  close: (pool) => pool.end(),
});

const mapError = (error, timeoutMs) => {
  if (CONNECT_ERROR_CODES.has(error.code)) {
    return connectError(error);
  }
  // 3024: MAX_EXECUTION_TIME exceeded (server side). PROTOCOL_SEQUENCE_TIMEOUT: our client-side timeout
  if (error.errno === 3024 || error.code === "PROTOCOL_SEQUENCE_TIMEOUT") {
    return queryError(`Query cancelled: it ran longer than ${timeoutMs / 1000}s`, { code: error.code });
  }
  // 1792: statement not allowed in a READ ONLY transaction
  if (error.errno === 1792) {
    return queryError("This connection is read-only. Turn off read-only mode to run writes.", { code: error.code });
  }
  return queryError(error.sqlMessage || error.message, { code: error.code });
};

// Runs fn(conn) in a transaction that is always rolled back, READ ONLY by default.
// Used for everything Quereo runs on its own (plans, stats).
const withSession = async (connection, config, timeoutMs, fn, { readOnly = true } = {}) => {
  let conn;
  try {
    conn = await pools.get(connection, config).getConnection();
  } catch (error) {
    throw connectError(error);
  }

  let broken = false;
  try {
    await conn.query(`SET SESSION TRANSACTION ${readOnly ? "READ ONLY" : "READ WRITE"}`);
    await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Number(timeoutMs)}`);
    await conn.query("START TRANSACTION");
    return await fn(conn);
  } catch (error) {
    if (error.fatal || error.code === "PROTOCOL_SEQUENCE_TIMEOUT") broken = true;
    throw mapError(error, timeoutMs);
  } finally {
    if (!broken) await conn.query("ROLLBACK").catch(() => { broken = true; });
    if (broken) conn.destroy();
    else conn.release();
  }
};

// MySQL 8.3+ "format version 2" plan JSON is a tree of steps ("inputs").
// A full table scan is a step with access_type "table"; the WHERE condition
// sits on its parent "filter" step, which also says how many rows survived.
const normalizePlan = (planJson, analyzed) => {
  const nodes = [];
  const rows = (node) =>
    analyzed ? Math.round((node.actual_rows ?? 0) * (node.actual_loops ?? 1)) : Math.round(node.estimated_rows ?? 0);

  const walk = (node, parent) => {
    const filterParent = parent?.access_type === "filter" ? parent : null;

    nodes.push({
      operation: node.operation,
      table: node.table_name || null,
      fullScan: node.access_type === "table",
      indexName: node.index_name || null,
      filter: node.condition || (node.table_name && filterParent?.condition) || null,
      rowsExamined: node.table_name ? rows(node) : null,
      rowsReturned: node.table_name && filterParent ? rows(filterParent) : rows(node),
      estimatedRows: Math.round(node.estimated_rows ?? 0),
      actualRows: analyzed ? node.actual_rows ?? null : null,
      // MySQL doesn't report whether a sort spilled to disk in the plan
      sortOnDisk: false,
      timeMs: analyzed ? node.actual_last_row_ms ?? null : null,
      estimated: !analyzed,
    });

    (node.inputs || []).forEach((child) => walk(child, node));
  };

  walk(planJson, null);

  return {
    analyzed,
    totalTimeMs: analyzed ? planJson.actual_last_row_ms ?? null : null,
    nodes,
    raw: planJson,
  };
};

// Format version 1 plan JSON. Only used for single-table UPDATE/DELETE, which
// version 2 can't describe. Tables appear as { "table": {...} } objects anywhere
// in the tree; "ALL" is a full table scan and "index" a full index scan
// (on InnoDB a full PRIMARY index scan reads the whole table too).
const normalizeLegacyPlan = (planJson) => {
  const nodes = [];

  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.table?.table_name) {
      const table = value.table;
      nodes.push({
        operation: `${table.access_type} access on ${table.table_name}`,
        table: table.table_name,
        fullScan: table.access_type === "ALL" || table.access_type === "index",
        indexName: table.key || null,
        filter: table.attached_condition || null,
        rowsExamined: Number(table.rows_examined_per_scan ?? 0),
        rowsReturned: null,
        estimatedRows: Number(table.rows_examined_per_scan ?? 0),
        actualRows: null,
        sortOnDisk: false,
        timeMs: null,
        estimated: true,
      });
    }
    Object.values(value).forEach(walk);
  };

  walk(planJson);
  return { analyzed: false, totalTimeMs: null, nodes, raw: planJson };
};

// Identifiers are always quoted, so nothing from a request can be read as SQL
const quoteIdent = (name) => `\`${String(name).replace(/`/g, "``")}\``;

const SLOW_QUERY_SORTS = {
  total: "SUM_TIMER_WAIT",
  mean: "AVG_TIMER_WAIT",
  calls: "COUNT_STAR",
};

// performance_schema timers are in picoseconds
const PICOSECONDS_PER_MS = 1e9;

const mysqlAdapter = {
  type: "mysql",
  label: "MySQL",
  defaultPort: 3306,
  queryLanguage: "sql",

  isReadQuery: isReadCommand,
  readQueryProblem: sqlReadProblem,
  canExplain: canExplainSql,

  async test(config) {
    let connection;
    try {
      connection = await mysql.createConnection(toMysqlConfig(config));
      const [rows] = await connection.query("SELECT VERSION() AS version, DATABASE() AS `database`");
      return { version: `MySQL ${rows[0].version}`, database: rows[0].database };
    } catch (error) {
      throw mapError(error);
    } finally {
      await connection?.end().catch(() => {});
    }
  },

  async runQuery(connection, config, sql, { readOnly, timeoutMs, maxRows }) {
    const pool = pools.get(connection, config);
    let conn;
    try {
      conn = await pool.getConnection();
    } catch (error) {
      throw connectError(error);
    }

    let broken = false;
    try {
      // Session-level READ ONLY (not just the transaction) matters in MySQL:
      // DDL like CREATE/DROP causes an implicit COMMIT, which would end a
      // read-only transaction early. The session setting covers that case.
      await conn.query(`SET SESSION TRANSACTION ${readOnly ? "READ ONLY" : "READ WRITE"}`);
      // Server-side limit for SELECTs, plus a client-side timeout for everything else
      await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Number(timeoutMs)}`);
      await conn.query("START TRANSACTION");

      const { result, durationMs } = await timed(() =>
        conn.query({ sql, rowsAsArray: true, timeout: timeoutMs + 1_000 })
      );
      const [data, fields] = result;

      await conn.query("COMMIT");

      // SELECT-like statements return rows; writes return a header with affectedRows
      if (Array.isArray(data)) {
        return {
          command: getCommand(sql),
          columns: (fields || []).map((field) => field.name),
          rows: data.slice(0, maxRows),
          rowCount: data.length,
          truncated: data.length > maxRows,
          durationMs,
        };
      }

      return {
        command: getCommand(sql),
        columns: [],
        rows: [],
        rowCount: data.affectedRows ?? 0,
        truncated: false,
        durationMs,
      };
    } catch (error) {
      // Our client-side timeout only stops waiting; the server would keep running
      // the statement (MAX_EXECUTION_TIME covers SELECTs only), so kill it there too
      if (error.code === "PROTOCOL_SEQUENCE_TIMEOUT") {
        await pool.query(`KILL QUERY ${Number(conn.threadId)}`).catch(() => {});
      }
      if (error.code === "PROTOCOL_SEQUENCE_TIMEOUT" || error.fatal) broken = true;
      if (!broken) await conn.query("ROLLBACK").catch(() => { broken = true; });
      throw mapError(error, timeoutMs);
    } finally {
      // A timed-out or broken connection is destroyed instead of going back to the pool
      if (broken) conn.destroy();
      else conn.release();
    }
  },

  // EXPLAIN ANALYZE runs the query and reports real row counts and timings.
  // Without ANALYZE (used for writes) the numbers are the optimizer's estimates.
  explain(connection, config, sql, { analyze, timeoutMs }) {
    // MySQL refuses even a plain "EXPLAIN UPDATE" in a READ ONLY transaction.
    // Plain EXPLAIN never executes the statement, so only ANALYZE needs read-only;
    // the transaction is rolled back either way.
    return withSession(connection, config, timeoutMs, async (conn) => {
      try {
        await conn.query("SET SESSION explain_json_format_version = 2");
      } catch {
        throw queryError("Query plans need MySQL 8.3 or newer");
      }

      const [rows] = await conn.query({
        sql: `EXPLAIN ${analyze ? "ANALYZE " : ""}FORMAT=JSON ${sql}`,
        timeout: timeoutMs + 1_000,
      });
      const planJson = JSON.parse(Object.values(rows[0])[0]);

      if (/not executable/i.test(planJson.operation || "")) {
        await conn.query("SET SESSION explain_json_format_version = 1");
        const [legacyRows] = await conn.query({ sql: `EXPLAIN FORMAT=JSON ${sql}`, timeout: timeoutMs + 1_000 });
        return normalizeLegacyPlan(JSON.parse(Object.values(legacyRows[0])[0]));
      }

      return normalizePlan(planJson, analyze);
    }, { readOnly: analyze });
  },

  // Reads performance_schema's per-query-shape statistics ("digests").
  // Constants are replaced by ?, so "WHERE id = 5" and "WHERE id = 7" count as one query.
  getSlowQueries(connection, config, { sortBy, limit }) {
    return withSession(connection, config, 10_000, async (conn) => {
      const [[{ enabled }]] = await conn.query("SELECT @@performance_schema AS enabled");
      if (!Number(enabled)) {
        throw queryError("performance_schema is turned off on this server. Set performance_schema=ON in my.cnf and restart MySQL.");
      }

      const [rows] = await conn.query(
        `SELECT DIGEST AS id,
                DIGEST_TEXT AS query,
                COUNT_STAR AS calls,
                SUM_TIMER_WAIT AS totalWait,
                AVG_TIMER_WAIT AS avgWait,
                MAX_TIMER_WAIT AS maxWait,
                SUM_ROWS_SENT AS rowsSent,
                SUM_ROWS_EXAMINED AS rowsExamined,
                SUM_NO_INDEX_USED AS noIndexUsed
         FROM performance_schema.events_statements_summary_by_digest
         WHERE SCHEMA_NAME = DATABASE()
           AND DIGEST_TEXT IS NOT NULL
           AND DIGEST_TEXT NOT REGEXP '^(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SET|SHOW|EXPLAIN)'
           AND DIGEST_TEXT NOT LIKE '%performance_schema%'
           -- Quereo's own work: schema and index reads, version checks, index trials
           AND DIGEST_TEXT NOT LIKE '%information_schema%'
           AND DIGEST_TEXT NOT REGEXP '^SELECT .?VERSION.? ?[(]'
           AND DIGEST_TEXT NOT LIKE '%quereo_trial_%'
           AND DIGEST_TEXT NOT LIKE '%querylens_trial_%'
         ORDER BY ${SLOW_QUERY_SORTS[sortBy]} DESC
         LIMIT ?`,
        [limit]
      );

      return rows.map((row) => ({
        id: row.id,
        query: row.query,
        calls: Number(row.calls),
        totalMs: Number(row.totalWait) / PICOSECONDS_PER_MS,
        meanMs: Number(row.avgWait) / PICOSECONDS_PER_MS,
        maxMs: Number(row.maxWait) / PICOSECONDS_PER_MS,
        rows: Number(row.rowsSent),
        // MySQL extras: rows read vs. sent, and how often no index was used
        rowsExamined: Number(row.rowsExamined),
        noIndexUsed: Number(row.noIndexUsed),
      }));
    });
  },

  // Tables, columns and indexes in a common format (see services/schema.service.js)
  getSchema(connection, config) {
    return withSession(connection, config, 15_000, async (conn) => {
      const [columns] = await conn.query(`
        SELECT c.TABLE_SCHEMA AS \`schema\`, c.TABLE_NAME AS \`table\`, t.TABLE_ROWS AS rowEstimate,
               c.COLUMN_NAME AS \`column\`, c.COLUMN_TYPE AS type,
               c.IS_NULLABLE = 'YES' AS nullable, c.COLUMN_DEFAULT AS defaultValue
        FROM information_schema.COLUMNS c
        JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);

      const [indexColumns] = await conn.query(`
        SELECT TABLE_NAME AS \`table\`, INDEX_NAME AS \`index\`, NON_UNIQUE AS nonUnique, COLUMN_NAME AS \`column\`
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`);

      const tables = {};
      for (const row of columns) {
        tables[row.table] ??= { schema: row.schema, name: row.table, rowEstimate: Number(row.rowEstimate || 0), columns: {}, indexes: {} };
        tables[row.table].columns[row.column] = { type: row.type, nullable: Boolean(row.nullable), default: row.defaultValue };
      }
      for (const row of indexColumns) {
        const table = tables[row.table];
        if (!table) continue;
        table.indexes[row.index] ??= {
          columns: [],
          unique: !Number(row.nonUnique),
          primary: row.index === "PRIMARY",
        };
        table.indexes[row.index].columns.push(row.column);
      }
      for (const table of Object.values(tables)) {
        for (const [name, index] of Object.entries(table.indexes)) {
          index.definition = `${index.unique ? "UNIQUE " : ""}INDEX ${name} (${index.columns.join(", ")})`;
        }
      }

      return { engine: "mysql", tables };
    });
  },

  // How often each index has been READ since the server started.
  // (COUNT_STAR would also count index updates from inserts, which isn't "use".)
  getIndexUsage(connection, config) {
    return withSession(connection, config, 15_000, async (conn) => {
      const [rows] = await conn.query(`
        SELECT u.OBJECT_NAME AS \`table\`, u.INDEX_NAME AS \`index\`, u.COUNT_READ AS scans,
               s.stat_value * @@innodb_page_size AS sizeBytes,
               (SELECT MIN(NON_UNIQUE) = 0 FROM information_schema.STATISTICS st
                WHERE st.TABLE_SCHEMA = u.OBJECT_SCHEMA AND st.TABLE_NAME = u.OBJECT_NAME AND st.INDEX_NAME = u.INDEX_NAME) AS isUnique
        FROM performance_schema.table_io_waits_summary_by_index_usage u
        LEFT JOIN mysql.innodb_index_stats s
          ON s.database_name = u.OBJECT_SCHEMA AND s.table_name = u.OBJECT_NAME
         AND s.index_name = u.INDEX_NAME AND s.stat_name = 'size'
        WHERE u.OBJECT_SCHEMA = DATABASE() AND u.INDEX_NAME IS NOT NULL`);
      const [[{ uptime }]] = await conn.query(
        "SELECT VARIABLE_VALUE AS uptime FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime'"
      );

      return {
        statsSince: new Date(Date.now() - Number(uptime) * 1000),
        indexes: rows.map((row) => ({
          table: row.table,
          index: row.index,
          scans: Number(row.scans),
          sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
          unique: Boolean(Number(row.isUnique)),
          primary: row.index === "PRIMARY",
          dropStatement: `DROP INDEX ${quoteIdent(row.index)} ON ${quoteIdent(row.table)};`,
        })),
      };
    });
  },

  createIndexStatement({ table, columns, indexName }) {
    // InnoDB builds secondary indexes online: reads and writes keep working
    return `CREATE INDEX ${quoteIdent(indexName)} ON ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")});`;
  },

  // Measures a query before and after adding an index. MySQL can't roll back
  // DDL (CREATE INDEX commits immediately), so the index is really created
  // and then dropped again in `finally`, even if measuring fails.
  async tryIndex(connection, config, { sql, table, columns, timeoutMs }) {
    let conn;
    try {
      conn = await pools.get(connection, config).getConnection();
    } catch (error) {
      throw connectError(error);
    }

    const measure = async () => {
      const runOnce = async () => {
        const [rows] = await conn.query({ sql: `EXPLAIN ANALYZE FORMAT=JSON ${sql}`, timeout: timeoutMs + 1_000 });
        return normalizePlan(JSON.parse(Object.values(rows[0])[0]), true);
      };
      const first = await runOnce();
      const second = await runOnce();
      return first.totalTimeMs <= second.totalTimeMs ? first : second;
    };

    const indexName = `quereo_trial_${Date.now()}`;
    let created = false;
    try {
      await conn.query("SET SESSION TRANSACTION READ WRITE");
      await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Number(timeoutMs)}`);
      await conn.query("SET SESSION explain_json_format_version = 2");

      const before = await measure();
      await conn.query(`CREATE INDEX ${quoteIdent(indexName)} ON ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})`);
      created = true;
      const after = await measure();

      return { before, after, indexName, persisted: false };
    } catch (error) {
      throw mapError(error, timeoutMs);
    } finally {
      if (created) {
        try {
          await conn.query(`DROP INDEX ${quoteIdent(indexName)} ON ${quoteIdent(table)}`);
        } catch (error) {
          console.error(`Could not drop trial index ${indexName} on ${table}: ${error.message}`);
        }
      }
      conn.release();
    }
  },

  close: (connectionId) => pools.remove(connectionId),
  closeAll: () => pools.clear(),
};

export { mysqlAdapter };
