import pg from "pg";
import { createPoolCache } from "./poolCache.js";
import { getCommand, isReadCommand, sqlReadProblem, canExplainSql, queryError, connectError, timed } from "./utils.js";

// Postgres error codes we turn into friendlier messages
const QUERY_CANCELED = "57014";
const READ_ONLY_VIOLATION = "25006";
// Errors that mean we never reached a working session
const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "28P01", "28000", "3D000"]);

const toPgConfig = (config) => ({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.username,
  password: config.password,
  ssl: config.ssl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5_000,
  application_name: "quereo",
});

const pools = createPoolCache({
  create: (config) => {
    const pool = new pg.Pool({ ...toPgConfig(config), max: 3, idleTimeoutMillis: 30_000 });
    // An idle client dying (e.g. the database restarted) must not crash our server
    pool.on("error", () => {});
    return pool;
  },
  close: (pool) => pool.end(),
});

const mapError = (error, timeoutMs) => {
  if (CONNECT_ERROR_CODES.has(error.code) || /timeout expired|connection terminated/i.test(error.message)) {
    return connectError(error);
  }
  if (error.code === QUERY_CANCELED) {
    return queryError(`Query cancelled: it ran longer than ${timeoutMs / 1000}s`, { code: error.code });
  }
  if (error.code === READ_ONLY_VIOLATION) {
    return queryError("This connection is read-only. Turn off read-only mode to run writes.", { code: error.code });
  }
  if (/multiple commands into a prepared statement/.test(error.message)) {
    return queryError("Run one statement at a time", { code: error.code });
  }
  return queryError(error.message, { code: error.code, position: error.position, hint: error.hint });
};

// Runs fn(client) inside a READ ONLY transaction that is always rolled back.
// Used for everything Quereo runs on its own (plans, stats), so even an
// EXPLAIN ANALYZE can never leave a change behind.
const withReadOnlyTransaction = async (connection, config, timeoutMs, fn) => {
  let client;
  try {
    client = await pools.get(connection, config).connect();
  } catch (error) {
    throw connectError(error);
  }

  let broken = false;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    return await fn(client);
  } catch (error) {
    throw mapError(error, timeoutMs);
  } finally {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    client.release(broken);
  }
};

// Flattens Postgres's nested plan JSON into the common node format
// shared by every adapter (see services/verdict.service.js)
const normalizePlan = (planJson, analyzed) => {
  const nodes = [];

  const walk = (plan) => {
    const loops = plan["Actual Loops"] || 1;
    const rowsReturned = analyzed ? Math.round(plan["Actual Rows"] * loops) : null;
    const removed = analyzed ? Math.round((plan["Rows Removed by Filter"] || 0) * loops) : 0;

    nodes.push({
      operation: plan["Node Type"],
      table: plan["Relation Name"] || null,
      fullScan: plan["Node Type"] === "Seq Scan",
      indexName: plan["Index Name"] || null,
      filter: plan["Filter"] || null,
      // How many rows the database had to read vs. how many it kept
      rowsExamined: analyzed ? rowsReturned + removed : null,
      rowsReturned,
      estimatedRows: plan["Plan Rows"],
      actualRows: analyzed ? plan["Actual Rows"] : null,
      sortOnDisk: plan["Sort Space Type"] === "Disk",
      timeMs: analyzed ? plan["Actual Total Time"] : null,
      // Parallel scans report a rounded per-worker average, so totals are approximate
      approximate: loops > 1,
    });

    (plan.Plans || []).forEach(walk);
  };

  walk(planJson.Plan);

  return {
    analyzed,
    totalTimeMs: analyzed ? planJson["Execution Time"] : null,
    nodes,
    raw: planJson,
  };
};

// Identifiers are always quoted, so a table called "order" or "User" works
// and nothing from a request can be interpreted as SQL
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Tables outside "public" are named schema.table
const tableKey = (schema, table) => (schema === "public" ? table : `${schema}.${table}`);

const USER_SCHEMAS_FILTER = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'";

const SLOW_QUERY_SORTS = {
  total: "total_exec_time",
  mean: "mean_exec_time",
  calls: "calls",
};

const postgresAdapter = {
  type: "postgres",
  label: "PostgreSQL",
  defaultPort: 5432,
  queryLanguage: "sql",

  isReadQuery: isReadCommand,
  readQueryProblem: sqlReadProblem,
  canExplain: canExplainSql,

  async test(config) {
    const client = new pg.Client(toPgConfig(config));
    try {
      await client.connect();
      const { rows } = await client.query("SELECT version() AS version, current_database() AS database");
      return { version: rows[0].version, database: rows[0].database };
    } catch (error) {
      throw mapError(error);
    } finally {
      await client.end().catch(() => {});
    }
  },

  async runQuery(connection, config, sql, { readOnly, timeoutMs, maxRows }) {
    let client;
    try {
      client = await pools.get(connection, config).connect();
    } catch (error) {
      throw connectError(error);
    }

    let broken = false;
    try {
      // Every run is its own transaction, so SET LOCAL only affects this query
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);

      // queryMode "extended" uses the prepared-statement protocol, which rejects
      // "SELECT 1; DROP TABLE x" - only a single statement can ever run.
      // rowMode "array" keeps duplicate column names (e.g. two "id" columns in a join).
      const { result, durationMs } = await timed(() =>
        client.query({ text: sql, rowMode: "array", queryMode: "extended" })
      );

      await client.query("COMMIT");

      const columns = (result.fields || []).map((field) => field.name);
      const rows = result.rows || [];

      return {
        command: result.command || getCommand(sql),
        columns,
        rows: rows.slice(0, maxRows),
        rowCount: result.fields?.length ? rows.length : result.rowCount ?? 0,
        truncated: rows.length > maxRows,
        durationMs,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      throw mapError(error, timeoutMs);
    } finally {
      // Passing true destroys a client whose connection is broken instead of reusing it
      client.release(broken);
    }
  },

  // EXPLAIN shows the plan the database picked. With ANALYZE it also runs the
  // query and reports real row counts and timings for every step.
  explain(connection, config, sql, { analyze, timeoutMs }) {
    const options = analyze ? "ANALYZE, BUFFERS, FORMAT JSON" : "FORMAT JSON";

    return withReadOnlyTransaction(connection, config, timeoutMs, async (client) => {
      const { rows } = await client.query({ text: `EXPLAIN (${options}) ${sql}`, queryMode: "extended" });
      const plan = normalizePlan(rows[0]["QUERY PLAN"][0], analyze);

      // Plain EXPLAIN doesn't say how big a scanned table is, so use the
      // planner's row estimate from pg_class instead
      if (!analyze) {
        const scanned = plan.nodes.filter((node) => node.fullScan && node.table);
        if (scanned.length) {
          const { rows: sizes } = await client.query(
            "SELECT relname, reltuples FROM pg_class WHERE relkind = 'r' AND relname = ANY($1)",
            [scanned.map((node) => node.table)]
          );
          const sizeByTable = new Map(sizes.map((row) => [row.relname, Math.round(row.reltuples)]));
          scanned.forEach((node) => {
            node.rowsExamined = sizeByTable.get(node.table) ?? null;
            node.estimated = true;
          });
        }
      }

      return plan;
    });
  },

  // Reads pg_stat_statements: Postgres's built-in record of every query shape
  // it has run, with call counts and timings. Constants are replaced by $1, $2...
  // so "WHERE id = 5" and "WHERE id = 7" count as the same query.
  getSlowQueries(connection, config, { sortBy, limit }) {
    return withReadOnlyTransaction(connection, config, 10_000, async (client) => {
      try {
        const { rows } = await client.query(
          `SELECT queryid::text AS id,
                  query,
                  calls,
                  total_exec_time AS "totalMs",
                  mean_exec_time AS "meanMs",
                  max_exec_time AS "maxMs",
                  rows,
                  shared_blks_hit AS "cacheHits",
                  shared_blks_read AS "diskReads"
           FROM pg_stat_statements
           WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
             AND query !~* '^\\s*(BEGIN|COMMIT|ROLLBACK|SET|SHOW|EXPLAIN)\\y'
             AND query !~* 'pg_stat_statements'
             -- Quereo's own work: schema and index reads, version checks, index trials
             AND query !~* '(pg_catalog|information_schema|pg_namespace|pg_class|pg_index|pg_attribute|pg_stat_user_indexes|pg_stat_user_tables|pg_stat_database|pg_database|pg_postmaster_start_time)'
             AND query !~* '^[[:space:]]*SELECT[[:space:]]+version[(]'
             AND query !~* '(quereo|querylens)_trial_'
           ORDER BY ${SLOW_QUERY_SORTS[sortBy]} DESC
           LIMIT $1`,
          [limit]
        );

        return rows.map((row) => ({
          id: row.id,
          query: row.query,
          calls: Number(row.calls),
          totalMs: Number(row.totalMs),
          meanMs: Number(row.meanMs),
          maxMs: Number(row.maxMs),
          rows: Number(row.rows),
          // Share of data pages found in memory instead of read from disk
          cacheHitRatio:
            Number(row.cacheHits) + Number(row.diskReads) > 0
              ? Number(row.cacheHits) / (Number(row.cacheHits) + Number(row.diskReads))
              : null,
        }));
      } catch (error) {
        if (error.code === "42P01" || error.code === "55000") {
          throw queryError(
            "pg_stat_statements is not enabled on this database. Add it to shared_preload_libraries, restart Postgres, then run: CREATE EXTENSION pg_stat_statements;",
            { code: error.code }
          );
        }
        throw error;
      }
    });
  },

  // Tables, columns and indexes in a common format (see services/schema.service.js)
  getSchema(connection, config) {
    return withReadOnlyTransaction(connection, config, 15_000, async (client) => {
      const { rows: columns } = await client.query(`
        SELECT n.nspname AS schema, c.relname AS table, c.reltuples AS row_estimate,
               a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
               NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default_value
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped AND ${USER_SCHEMAS_FILTER}
        ORDER BY n.nspname, c.relname, a.attnum`);

      const { rows: indexes } = await client.query(`
        SELECT n.nspname AS schema, t.relname AS table, i.relname AS index,
               ix.indisunique AS unique, ix.indisprimary AS primary,
               ARRAY(
                 SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                 ORDER BY k.ord
               )::text[] AS columns,
               pg_get_indexdef(ix.indexrelid) AS definition
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE ${USER_SCHEMAS_FILTER}`);

      const tables = {};
      for (const row of columns) {
        const key = tableKey(row.schema, row.table);
        tables[key] ??= { schema: row.schema, name: row.table, rowEstimate: Math.max(Math.round(row.row_estimate), 0), columns: {}, indexes: {} };
        tables[key].columns[row.column] = { type: row.type, nullable: row.nullable, default: row.default_value };
      }
      for (const row of indexes) {
        const table = tables[tableKey(row.schema, row.table)];
        if (!table) continue;
        table.indexes[row.index] = { columns: row.columns, unique: row.unique, primary: row.primary, definition: row.definition };
      }

      return { engine: "postgres", tables };
    });
  },

  // How often each index has been used since statistics were last reset
  getIndexUsage(connection, config) {
    return withReadOnlyTransaction(connection, config, 15_000, async (client) => {
      const { rows } = await client.query(`
        SELECT s.schemaname AS schema, s.relname AS table, s.indexrelname AS index,
               s.idx_scan AS scans, pg_relation_size(s.indexrelid) AS size_bytes,
               ix.indisunique AS unique, ix.indisprimary AS primary
        FROM pg_stat_user_indexes s
        JOIN pg_index ix ON ix.indexrelid = s.indexrelid`);
      const { rows: [reset] } = await client.query(
        // Never reset = counting since the server started
        "SELECT COALESCE(stats_reset, pg_postmaster_start_time()) AS stats_reset FROM pg_stat_database WHERE datname = current_database()"
      );

      return {
        statsSince: reset?.stats_reset || null,
        indexes: rows.map((row) => ({
          table: tableKey(row.schema, row.table),
          index: row.index,
          scans: Number(row.scans),
          sizeBytes: Number(row.size_bytes),
          unique: row.unique,
          primary: row.primary,
          dropStatement: `DROP INDEX CONCURRENTLY ${quoteIdent(row.schema)}.${quoteIdent(row.index)};`,
        })),
      };
    });
  },

  createIndexStatement({ schema, table, columns, indexName }) {
    // CONCURRENTLY builds the index without blocking writes to the table
    return `CREATE INDEX CONCURRENTLY ${quoteIdent(indexName)} ON ${quoteIdent(schema)}.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")});`;
  },

  // Measures a query before and after adding an index, without keeping the index:
  // everything happens inside one transaction that is rolled back at the end.
  // (Building the index briefly blocks writes to the table, so use dev/staging.)
  async tryIndex(connection, config, { sql, schema, table, columns, timeoutMs }) {
    let client;
    try {
      client = await pools.get(connection, config).connect();
    } catch (error) {
      throw connectError(error);
    }

    // Best of two runs, so a cold cache doesn't make "before" look worse than it is
    const measure = async () => {
      const runOnce = async () => {
        const { rows } = await client.query({ text: `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, queryMode: "extended" });
        return normalizePlan(rows[0]["QUERY PLAN"][0], true);
      };
      const first = await runOnce();
      const second = await runOnce();
      return first.totalTimeMs <= second.totalTimeMs ? first : second;
    };

    const indexName = `quereo_trial_${Date.now()}`;
    let broken = false;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);

      const before = await measure();
      await client.query(
        `CREATE INDEX ${quoteIdent(indexName)} ON ${quoteIdent(schema)}.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})`
      );
      const after = await measure();

      return { before, after, indexName, persisted: false };
    } catch (error) {
      throw mapError(error, timeoutMs);
    } finally {
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      client.release(broken);
    }
  },

  close: (connectionId) => pools.remove(connectionId),
  closeAll: () => pools.clear(),
};

export { postgresAdapter };
