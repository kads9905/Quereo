import { ApiError } from "../utils/ApiError.js";

// First keyword of a statement, e.g. "SELECT", "UPDATE", "WITH".
// Leading comments are skipped so "-- note\nSELECT 1" counts as a SELECT.
const getCommand = (sql) => {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  return (withoutComments.match(/^[a-z]+/i)?.[0] || "").toUpperCase();
};

const READ_COMMANDS = new Set(["SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE"]);

const isReadCommand = (sql) => READ_COMMANDS.has(getCommand(sql));

const sqlReadProblem = (sql) => (isReadCommand(sql) ? null : "Only a single SELECT statement is allowed");

// SQL statements both SQL adapters can EXPLAIN
const EXPLAINABLE_SQL = new Set(["SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "VALUES", "TABLE"]);
const canExplainSql = (sql) => EXPLAINABLE_SQL.has(getCommand(sql));

// Errors coming back from the user's database (bad SQL, timeouts, can't connect)
// are the user's problem to fix, not a server bug, so they become 400s
// and keep the database's own message.
const queryError = (message, details = {}) => new ApiError(400, message, [details]);

const connectError = (error) =>
  new ApiError(400, `Could not connect to the database: ${error.message}`, [{ code: error.code }]);

// Measures a promise in milliseconds with 2 decimals
const timed = async (fn) => {
  const start = performance.now();
  const result = await fn();
  return { result, durationMs: Math.round((performance.now() - start) * 100) / 100 };
};

export { getCommand, isReadCommand, sqlReadProblem, canExplainSql, queryError, connectError, timed };
