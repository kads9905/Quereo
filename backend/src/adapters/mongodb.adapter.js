import { MongoClient, BSON } from "mongodb";
import { createPoolCache } from "./poolCache.js";
import { queryError, connectError, timed } from "./utils.js";

const { EJSON } = BSON;

// MongoDB has no SQL. A "query" here is a native MongoDB database command
// written as JSON (Extended JSON, so {"$oid": "..."} and {"$date": "..."} work):
//   {"find": "orders", "filter": {"customerId": 42}, "sort": {"createdAt": -1}, "limit": 10}
//   {"aggregate": "orders", "pipeline": [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]}
//   {"count": "orders", "query": {"status": "paid"}}
//   {"distinct": "orders", "key": "status"}
//   {"update": "orders", "updates": [{"q": {...}, "u": {"$set": {...}}}]}   (writes)
const READ_COMMANDS = new Set(["find", "aggregate", "count", "distinct"]);
const WRITE_COMMANDS = new Set(["insert", "update", "delete"]);
const EXPLAINABLE_COMMANDS = new Set(["find", "aggregate", "count", "distinct", "update", "delete"]);
// Aggregation stages that write to a collection
const WRITE_STAGES = ["$out", "$merge"];

// Tag on Quereo's own commands, so the slow query list can leave them out
const INTERNAL_COMMENT = "quereo:internal";
// Tag used before the rename; old profiler entries still carry it
const LEGACY_INTERNAL_COMMENT = "querylens:internal";
const SCHEMA_SAMPLE_SIZE = 100;

const CONNECT_ERROR_NAMES = new Set(["MongoServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError"]);
const AUTH_FAILED = 18;
const MAX_TIME_EXPIRED = 50;

const buildUri = (config) => {
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
    : "";
  // Atlas and other hosted clusters use DNS seed lists (mongodb+srv), which have no port
  if (config.srv) return `mongodb+srv://${auth}${config.host}/${config.database}?authSource=admin`;
  return `mongodb://${auth}${config.host}:${config.port}/${config.database}?authSource=admin${config.ssl ? "&tls=true" : ""}`;
};

const clientOptions = {
  maxPoolSize: 3,
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
  appName: "quereo",
};

const clients = createPoolCache({
  create: (config) => new MongoClient(buildUri(config), clientOptions),
  close: (client) => client.close(),
});

const mapError = (error, timeoutMs) => {
  if (CONNECT_ERROR_NAMES.has(error.name) || error.code === AUTH_FAILED) return connectError(error);
  if (error.code === MAX_TIME_EXPIRED) {
    return queryError(`Query cancelled: it ran longer than ${timeoutMs / 1000}s`, { code: error.code });
  }
  if (error.statusCode) return error; // already an ApiError
  return queryError(error.message, { code: error.code });
};

// ---- Parsing commands ----

const parseCommand = (text) => {
  let command;
  try {
    command = EJSON.parse(text);
  } catch (error) {
    throw queryError(`A MongoDB query must be a JSON command, e.g. {"find": "orders", "filter": {}}. ${error.message}`);
  }
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw queryError('A MongoDB query must be a JSON object, e.g. {"find": "orders", "filter": {}}');
  }

  // Like MongoDB itself, the first key names the command
  const name = Object.keys(command)[0];
  if (!READ_COMMANDS.has(name) && !WRITE_COMMANDS.has(name)) {
    throw queryError(`Unsupported command "${name}". Use one of: ${[...READ_COMMANDS, ...WRITE_COMMANDS].join(", ")}`);
  }
  if (typeof command[name] !== "string" || !command[name]) {
    throw queryError(`"${name}" must be set to a collection name`);
  }
  return { name, collection: command[name], command };
};

const writesData = ({ name, command }) =>
  WRITE_COMMANDS.has(name) ||
  (name === "aggregate" && (command.pipeline || []).some((stage) => WRITE_STAGES.some((key) => key in stage)));

// MongoDB has no READ ONLY transaction, so "read-only" means: only allow-listed
// read commands, and no aggregation stage that writes ($out, $merge).
// Returns why a query isn't an acceptable read, or null if it is.
const readQueryProblem = (text) => {
  try {
    return writesData(parseCommand(text))
      ? "Only read commands are allowed (find, aggregate without $out/$merge, count, distinct)"
      : null;
  } catch (error) {
    return error.message;
  }
};

const isReadQuery = (text) => readQueryProblem(text) === null;

// ---- Turning documents into rows ----

// BSON types that JSON can't show nicely become strings
const toPlain = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    switch (value._bsontype) {
      case "ObjectId":
        return value.toHexString();
      case "Decimal128":
      case "Long":
      case "Timestamp":
        return value.toString();
      case "Binary":
        return value.toString("base64");
      default:
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toPlain(inner)]));
    }
  }
  return value;
};

// Documents can have different fields: columns are every top-level field
// seen, in order of first appearance, and missing fields become null
const documentsToTable = (docs) => {
  const columns = [];
  const seen = new Set();
  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return { columns, rows: docs.map((doc) => columns.map((column) => toPlain(doc[column]))) };
};

const bsonTypeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value?._bsontype) return value._bsontype.toLowerCase();
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  if (typeof value === "boolean") return "bool";
  return typeof value; // "string" | "object"
};

// ---- Plans ----

// Which fields a filter uses and how, straight from the filter document
// (no text parsing needed, unlike SQL). Fields inside $or are skipped:
// a single compound index can't serve every branch of an $or.
const extractFilterFields = (filter, found = []) => {
  if (!filter || typeof filter !== "object") return found;

  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$and") {
      condition.forEach((part) => extractFilterFields(part, found));
      continue;
    }
    if (key.startsWith("$")) continue;

    const operators = condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date) && !condition._bsontype
      ? Object.keys(condition)
      : ["$eq"];

    if (operators.some((op) => ["$ne", "$nin", "$not", "$exists"].includes(op))) continue;
    const kind = operators.every((op) => ["$eq", "$in"].includes(op)) ? "equality" : "range";
    found.push({ column: key, kind, position: found.length });
  }
  return found;
};

// Finds the first node with a given stage name in a classic execution tree
const findStage = (node, stage) => {
  if (!node) return null;
  if (node.stage === stage) return node;
  for (const child of [node.inputStage, ...(node.inputStages || [])]) {
    const found = findStage(child, stage);
    if (found) return found;
  }
  return null;
};

const normalizePlan = (explainResult, collection, analyzed) => {
  // Aggregations that can't be pushed into the query engine nest their plan under $cursor
  const cursorStage = explainResult.stages?.[0]?.$cursor;
  const queryPlanner = explainResult.queryPlanner || cursorStage?.queryPlanner;
  const executionStats = explainResult.executionStats || cursorStage?.executionStats;

  // MongoDB 7+ wraps the plan tree in "queryPlan" when the newer engine (SBE) is used
  const root = queryPlanner.winningPlan.queryPlan || queryPlanner.winningPlan;
  const nodes = [];

  const walk = (node) => {
    if (!node) return;
    const scansCollection = node.stage === "COLLSCAN" || node.stage === "IXSCAN";

    let rowsExamined = null;
    let rowsReturned = null;
    if (analyzed && node.stage === "COLLSCAN") {
      rowsExamined = executionStats.totalDocsExamined;
      rowsReturned = findStage(executionStats.executionStages, "COLLSCAN")?.nReturned ?? null;
    }
    if (analyzed && node.stage === "IXSCAN") rowsExamined = executionStats.totalKeysExamined;

    nodes.push({
      operation: node.stage,
      table: scansCollection ? collection : null,
      fullScan: node.stage === "COLLSCAN",
      indexName: node.indexName || null,
      filter: node.filter ? EJSON.stringify(node.filter) : null,
      filterFields: node.filter ? extractFilterFields(node.filter) : [],
      rowsExamined,
      rowsReturned,
      // MongoDB plans don't include row estimates
      estimatedRows: null,
      actualRows: null,
      sortOnDisk: false,
      timeMs: null,
      estimated: !analyzed,
    });

    walk(node.inputStage);
    (node.inputStages || []).forEach(walk);
  };

  walk(root);

  return {
    analyzed,
    totalTimeMs: analyzed ? executionStats?.executionTimeMillis ?? null : null,
    nodes,
    raw: { queryPlanner, executionStats },
  };
};

// Commands sent to explain need the shape MongoDB expects
const toExplainable = ({ name, command }, timeoutMs) => {
  const inner = { ...command, maxTimeMS: timeoutMs };
  if (name === "aggregate") inner.cursor ??= {};
  return inner;
};

// ---- The adapter ----

const getDb = async (connection, config) => {
  const client = clients.get(connection, config);
  try {
    await client.connect();
  } catch (error) {
    throw connectError(error);
  }
  return client.db(config.database);
};

// Schema and index stats read each collection separately, so very large
// databases are capped to keep those requests fast
const MAX_COLLECTIONS = 200;

const listUserCollections = async (db) =>
  (await db.listCollections({ type: "collection" }, { nameOnly: true }).toArray())
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith("system."))
    .sort()
    .slice(0, MAX_COLLECTIONS);

const mongodbAdapter = {
  type: "mongodb",
  label: "MongoDB",
  defaultPort: 27017,
  queryLanguage: "mongodb-json",

  isReadQuery,
  readQueryProblem,
  canExplain: (text) => {
    try {
      return EXPLAINABLE_COMMANDS.has(parseCommand(text).name);
    } catch {
      return false;
    }
  },

  async test(config) {
    const client = new MongoClient(buildUri(config), clientOptions);
    try {
      await client.connect();
      const db = client.db(config.database);
      const info = await db.command({ buildInfo: 1 });
      return { version: `MongoDB ${info.version}`, database: config.database };
    } catch (error) {
      throw mapError(error);
    } finally {
      await client.close().catch(() => {});
    }
  },

  async runQuery(connection, config, text, { readOnly, timeoutMs, maxRows }) {
    const parsed = parseCommand(text);
    const { name, collection, command } = parsed;

    if (readOnly && writesData(parsed)) {
      throw queryError("This connection is read-only. Turn off read-only mode to run writes.");
    }

    const db = await getDb(connection, config);
    const coll = db.collection(collection);
    // Fetch one extra document to know whether the result was cut off
    const cap = maxRows + 1;

    try {
      const { result, durationMs } = await timed(async () => {
        if (name === "find") {
          const limit = command.limit ? Math.min(command.limit, cap) : cap;
          return coll
            .find(command.filter || {}, {
              projection: command.projection,
              sort: command.sort,
              skip: command.skip,
              maxTimeMS: timeoutMs,
            })
            .limit(limit)
            .toArray();
        }
        if (name === "aggregate") {
          const pipeline = command.pipeline || [];
          const endsWithWrite = writesData(parsed);
          return coll.aggregate(endsWithWrite ? pipeline : [...pipeline, { $limit: cap }], { maxTimeMS: timeoutMs }).toArray();
        }
        if (name === "count") {
          return coll.countDocuments(command.query || command.filter || {}, { maxTimeMS: timeoutMs });
        }
        if (name === "distinct") {
          return coll.distinct(command.key, command.query || command.filter || {}, { maxTimeMS: timeoutMs });
        }
        // insert / update / delete: sent as the raw database command
        return db.command({ ...command, maxTimeMS: timeoutMs });
      });

      if (name === "count") {
        return { command: "COUNT", columns: ["count"], rows: [[result]], rowCount: 1, truncated: false, durationMs };
      }
      if (name === "distinct") {
        const values = result.slice(0, maxRows).map((value) => [toPlain(value)]);
        return { command: "DISTINCT", columns: [command.key], rows: values, rowCount: result.length, truncated: result.length > maxRows, durationMs };
      }
      if (WRITE_COMMANDS.has(name)) {
        return { command: name.toUpperCase(), columns: [], rows: [], rowCount: result.n ?? 0, truncated: false, durationMs };
      }

      const docs = result.slice(0, maxRows);
      return {
        command: name.toUpperCase(),
        ...documentsToTable(docs),
        // For find/aggregate only the fetched documents are counted (at most maxRows)
        rowCount: docs.length,
        truncated: result.length > maxRows,
        durationMs,
      };
    } catch (error) {
      throw mapError(error, timeoutMs);
    }
  },

  // explain with "executionStats" really runs the query (but never applies writes:
  // MongoDB explains update/delete without modifying data)
  async explain(connection, config, text, { analyze, timeoutMs }) {
    const parsed = parseCommand(text);
    if (!EXPLAINABLE_COMMANDS.has(parsed.name)) throw queryError(`"${parsed.name}" can't be explained`);

    const db = await getDb(connection, config);
    try {
      const result = await db.command({
        explain: toExplainable(parsed, timeoutMs),
        verbosity: analyze ? "executionStats" : "queryPlanner",
      });
      const plan = normalizePlan(result, parsed.collection, analyze);

      // Without executionStats, use the collection size for full scans
      if (!analyze && plan.nodes.some((node) => node.fullScan)) {
        const size = await db.collection(parsed.collection).estimatedDocumentCount({ comment: INTERNAL_COMMENT });
        plan.nodes.filter((node) => node.fullScan).forEach((node) => {
          node.rowsExamined = size;
        });
      }
      return plan;
    } catch (error) {
      throw mapError(error, timeoutMs);
    }
  },

  // Reads the profiler collection (system.profile), MongoDB's record of operations.
  // Operations of the same shape (same query, different values) are grouped together.
  async getSlowQueries(connection, config, { sortBy, limit }) {
    const db = await getDb(connection, config);
    const { was: level } = await db.command({ profile: -1 });
    if (level === 0) {
      throw queryError("The MongoDB profiler is off for this database. Turn it on with: db.setProfilingLevel(1, { slowms: 100 })");
    }

    const sortField = { total: "totalMs", mean: "meanMs", calls: "calls" }[sortBy];
    const groups = await db.collection("system.profile").aggregate([
      {
        $match: {
          ns: { $not: /\.system\./ },
          "command.explain": { $exists: false },
          "command.comment": { $nin: [INTERNAL_COMMENT, LEGACY_INTERNAL_COMMENT] },
          $or: [
            { op: { $in: ["query", "update", "remove", "insert"] } },
            { op: "command", $or: [{ "command.aggregate": { $exists: true } }, { "command.count": { $exists: true } }, { "command.distinct": { $exists: true } }] },
          ],
        },
      },
      {
        $group: {
          _id: { ns: "$ns", op: "$op", shape: { $ifNull: ["$queryShapeHash", "$queryHash"] } },
          calls: { $sum: 1 },
          totalMs: { $sum: "$millis" },
          meanMs: { $avg: "$millis" },
          maxMs: { $max: "$millis" },
          rows: { $sum: { $ifNull: ["$nreturned", 0] } },
          rowsExamined: { $sum: { $ifNull: ["$docsExamined", 0] } },
          noIndexUsed: { $sum: { $cond: [{ $eq: ["$planSummary", "COLLSCAN"] }, 1, 0] } },
          command: { $last: "$command" },
        },
      },
      { $sort: { [sortField]: -1 } },
      { $limit: limit },
    ], { comment: INTERNAL_COMMENT }).toArray();

    return groups.map((group) => {
      // Drop driver bookkeeping fields so the query reads like what was written
      const { lsid, $db, $clusterTime, $readPreference, txnNumber, maxTimeMS, comment, cursor, ...shown } = group.command || {};
      return {
        id: `${group._id.ns}:${group._id.op}:${group._id.shape ?? "-"}`,
        query: EJSON.stringify(shown),
        calls: group.calls,
        totalMs: group.totalMs,
        meanMs: group.meanMs,
        maxMs: group.maxMs,
        rows: group.rows,
        rowsExamined: group.rowsExamined,
        noIndexUsed: group.noIndexUsed,
      };
    });
  },

  // MongoDB has no fixed schema, so it is inferred from the newest documents
  // (newest rather than random, so comparing two snapshots is stable)
  async getSchema(connection, config) {
    const db = await getDb(connection, config);
    const tables = {};

    for (const name of await listUserCollections(db)) {
      const coll = db.collection(name);
      const [rowEstimate, indexes, sample] = await Promise.all([
        coll.estimatedDocumentCount({ comment: INTERNAL_COMMENT }),
        coll.listIndexes().toArray(),
        coll.find({}, { comment: INTERNAL_COMMENT }).sort({ _id: -1 }).limit(SCHEMA_SAMPLE_SIZE).toArray(),
      ]);

      const fields = new Map();
      for (const doc of sample) {
        for (const [field, value] of Object.entries(doc)) {
          const info = fields.get(field) || { types: new Set(), seen: 0 };
          info.types.add(bsonTypeOf(value));
          info.seen += 1;
          fields.set(field, info);
        }
      }

      tables[name] = {
        schema: config.database,
        name,
        rowEstimate,
        sampled: sample.length,
        columns: Object.fromEntries(
          [...fields].map(([field, info]) => [field, {
            type: [...info.types].filter((type) => type !== "null").sort().join(" | ") || "null",
            // Missing from some documents, or explicitly null in some
            nullable: info.seen < sample.length || info.types.has("null"),
            default: null,
          }])
        ),
        indexes: Object.fromEntries(
          indexes.map((index) => [index.name, {
            columns: Object.keys(index.key),
            unique: Boolean(index.unique) || index.name === "_id_",
            primary: index.name === "_id_",
            definition: EJSON.stringify(index.key),
          }])
        ),
      };
    }

    return { engine: "mongodb", inferred: true, tables };
  },

  // $indexStats: how many times each index was used since the server started
  async getIndexUsage(connection, config) {
    const db = await getDb(connection, config);
    const indexes = [];
    let statsSince = null;

    for (const name of await listUserCollections(db)) {
      const coll = db.collection(name);
      const [stats, [collStats]] = await Promise.all([
        coll.aggregate([{ $indexStats: {} }], { comment: INTERNAL_COMMENT }).toArray(),
        coll.aggregate([{ $collStats: { storageStats: {} } }], { comment: INTERNAL_COMMENT }).toArray(),
      ]);

      for (const index of stats) {
        const since = index.accesses.since;
        if (!statsSince || since < statsSince) statsSince = since;
        indexes.push({
          table: name,
          index: index.name,
          scans: Number(index.accesses.ops),
          sizeBytes: collStats?.storageStats?.indexSizes?.[index.name] ?? null,
          unique: Boolean(index.spec.unique),
          primary: index.name === "_id_",
          dropStatement: `db.getCollection(${JSON.stringify(name)}).dropIndex(${JSON.stringify(index.name)})`,
        });
      }
    }

    return { statsSince, indexes };
  },

  // A mongosh command the user can copy and run
  createIndexStatement({ table, columns, indexName }) {
    const keys = Object.fromEntries(columns.map((column) => [column, 1]));
    return `db.getCollection(${JSON.stringify(table)}).createIndex(${JSON.stringify(keys)}, { name: ${JSON.stringify(indexName)} })`;
  },

  // Measures before and after an index. MongoDB index builds can't be rolled
  // back, so the index is really created and then dropped in `finally`.
  async tryIndex(connection, config, { sql, table, columns, timeoutMs }) {
    const parsed = parseCommand(sql);
    const db = await getDb(connection, config);
    const coll = db.collection(table);

    const measure = async () => {
      const runOnce = async () =>
        normalizePlan(
          await db.command({ explain: toExplainable(parsed, timeoutMs), verbosity: "executionStats" }),
          parsed.collection,
          true
        );
      const first = await runOnce();
      const second = await runOnce();
      return first.totalTimeMs <= second.totalTimeMs ? first : second;
    };

    const indexName = `quereo_trial_${Date.now()}`;
    let created = false;
    try {
      const before = await measure();
      await coll.createIndex(Object.fromEntries(columns.map((column) => [column, 1])), { name: indexName });
      created = true;
      const after = await measure();
      return { before, after, indexName, persisted: false };
    } catch (error) {
      throw mapError(error, timeoutMs);
    } finally {
      if (created) {
        await coll.dropIndex(indexName).catch((error) => {
          console.error(`Could not drop trial index ${indexName} on ${table}: ${error.message}`);
        });
      }
    }
  },

  close: (connectionId) => clients.remove(connectionId),
  closeAll: () => clients.clear(),
};

export { mongodbAdapter, extractFilterFields };
