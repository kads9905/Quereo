import { postgresAdapter } from "./postgres.adapter.js";
import { mysqlAdapter } from "./mysql.adapter.js";
import { mongodbAdapter } from "./mongodb.adapter.js";
import { ApiError } from "../utils/ApiError.js";

// Every database type implements the same interface:
//
//   queryLanguage                                 -> "sql" | "mongodb-json"
//   isReadQuery(text) / canExplain(text)          -> booleans, in the adapter's own query language
//   readQueryProblem(text)                        -> why a query isn't an acceptable read, or null
//   test(config)                                  -> { version, database }
//   runQuery(connection, config, text, options)   -> { command, columns, rows, rowCount, truncated, durationMs }
//   explain(connection, config, text, options)    -> { analyzed, totalTimeMs, nodes, raw }  (nodes in a common format)
//   getSlowQueries(connection, config, options)   -> [{ id, query, calls, totalMs, meanMs, maxMs, rows }]
//   getSchema(connection, config)                 -> { engine, tables: { name: { columns, indexes, rowEstimate } } }
//   getIndexUsage(connection, config)             -> { statsSince, indexes: [{ table, index, scans, sizeBytes }] }
//   createIndexStatement({ schema, table, columns, indexName }) -> statement the user can copy
//   tryIndex(connection, config, options)         -> { before, after }  (plans measured without keeping the index)
//   close(connectionId) / closeAll()
//
// The rest of the app only talks to this interface, so supporting a new
// database type means writing one new adapter and registering it here.
const adapters = {
  [postgresAdapter.type]: postgresAdapter,
  [mysqlAdapter.type]: mysqlAdapter,
  [mongodbAdapter.type]: mongodbAdapter,
};

const SUPPORTED_TYPES = Object.keys(adapters);

const getAdapter = (type) => {
  const adapter = adapters[type];
  if (!adapter) {
    throw new ApiError(400, `Unsupported database type: ${type}`);
  }
  return adapter;
};

const listAdapters = () =>
  Object.values(adapters).map(({ type, label, defaultPort, queryLanguage }) => ({ type, label, defaultPort, queryLanguage }));

const closeAllAdapters = () => Promise.all(Object.values(adapters).map((adapter) => adapter.closeAll()));

export { getAdapter, listAdapters, closeAllAdapters, SUPPORTED_TYPES };
