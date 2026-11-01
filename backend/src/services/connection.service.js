import mongoose from "mongoose";
import { Connection } from "../models/connection.model.js";
import { ApiError } from "../utils/ApiError.js";
import { decrypt } from "../utils/crypto.js";
import { getAdapter } from "../adapters/index.js";

// Every lookup is scoped to the logged-in user, so one user can never
// read or query another user's connection, even by guessing its id.
const getOwnedConnection = async (userId, connectionId, { withSecret = false } = {}) => {
  if (!mongoose.isValidObjectId(connectionId)) {
    throw new ApiError(400, "Invalid connection id");
  }

  const query = Connection.findOne({ _id: connectionId, user: userId });
  if (withSecret) query.select("+passwordEnc");

  const connection = await query;
  if (!connection) {
    throw new ApiError(404, "Connection not found");
  }
  return connection;
};

// The plain config an adapter needs, with the password decrypted in memory only
const toAdapterConfig = (connection) => ({
  host: connection.host,
  port: connection.port,
  database: connection.database,
  username: connection.username,
  password: decrypt(connection.passwordEnc),
  ssl: connection.ssl,
  srv: connection.srv,
});

const QUERY_DEFAULTS = { timeoutMs: 30_000, maxRows: 500 };

// Runs SQL against a saved connection using the right adapter for its type
const runOnConnection = (connection, sql, options = {}) =>
  getAdapter(connection.type).runQuery(connection, toAdapterConfig(connection), sql, {
    ...QUERY_DEFAULTS,
    readOnly: connection.readOnly,
    ...options,
  });

// "Is this a read?" depends on the query language (SQL vs MongoDB commands),
// so the connection's adapter decides
const isReadQueryFor = (connection, text) => getAdapter(connection.type).isReadQuery(text);

// Above this, re-running the query for EXPLAIN ANALYZE costs too much,
// so we fall back to the planner's estimates
const MAX_ANALYZE_MS = 5_000;

// Gets the plan for a query. ANALYZE (which really executes the query) is
// only used for reads; writes get the planner's estimates instead.
// Returns null when the statement can't be explained (e.g. SHOW, CREATE).
const explainOnConnection = async (connection, text, { analyze = true, timeoutMs = 30_000 } = {}) => {
  const adapter = getAdapter(connection.type);
  if (!adapter.canExplain(text)) return null;

  return adapter.explain(connection, toAdapterConfig(connection), text, {
    analyze: analyze && adapter.isReadQuery(text),
    timeoutMs,
  });
};

export { getOwnedConnection, toAdapterConfig, runOnConnection, explainOnConnection, isReadQueryFor, MAX_ANALYZE_MS };
