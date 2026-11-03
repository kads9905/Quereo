import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank } from "../utils/validate.js";
import { encrypt } from "../utils/crypto.js";
import { Connection } from "../models/connection.model.js";
import { SavedQuery } from "../models/savedQuery.model.js";
import { QueryHistory } from "../models/queryHistory.model.js";
import { Monitor } from "../models/monitor.model.js";
import { MonitorRun } from "../models/monitorRun.model.js";
import { Incident } from "../models/incident.model.js";
import { SchemaSnapshot } from "../models/schemaSnapshot.model.js";
import { getAdapter, listAdapters } from "../adapters/index.js";
import { getOwnedConnection, toAdapterConfig } from "../services/connection.service.js";

// Validates and normalises connection fields from the request body.
// On update (`existing` given) every field is optional and falls back to the saved value.
const readConnectionBody = (body = {}, existing) => {
  const pick = (key) => (body[key] !== undefined ? body[key] : existing?.[key]);

  const type = pick("type");
  const adapter = getAdapter(type);

  const fields = {
    name: pick("name"),
    type,
    host: pick("host"),
    port: body.port !== undefined ? Number(body.port) : existing?.port ?? adapter.defaultPort,
    database: pick("database"),
    username: pick("username"),
    ssl: Boolean(pick("ssl")),
    srv: type === "mongodb" && Boolean(pick("srv")),
    readOnly: pick("readOnly") !== undefined ? Boolean(pick("readOnly")) : true,
  };

  for (const key of ["name", "host", "database", "username"]) {
    if (isBlank(fields[key])) throw new ApiError(400, `${key} is required`);
    fields[key] = fields[key].trim();
  }

  if (!Number.isInteger(fields.port) || fields.port < 1 || fields.port > 65535) {
    throw new ApiError(400, "port must be between 1 and 65535");
  }

  // Password is required when creating; on update, omitting it keeps the old one
  if (body.password !== undefined) {
    if (typeof body.password !== "string") throw new ApiError(400, "password must be a string");
    fields.password = body.password;
  } else if (!existing) {
    throw new ApiError(400, "password is required");
  }

  return fields;
};

const getDatabaseTypes = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, listAdapters(), "Supported database types"));
});

// Tries a connection before saving it, so the user gets instant feedback
const testUnsavedConnection = asyncHandler(async (req, res) => {
  const fields = readConnectionBody({ name: "test", ...req.body });
  const info = await getAdapter(fields.type).test(fields);

  return res.status(200).json(new ApiResponse(200, info, "Connection successful"));
});

const createConnection = asyncHandler(async (req, res) => {
  const { password, ...fields } = readConnectionBody(req.body);

  // Never save a connection that doesn't work
  const info = await getAdapter(fields.type).test({ ...fields, password });

  const connection = await Connection.create({
    ...fields,
    user: req.user._id,
    passwordEnc: encrypt(password),
  });

  return res
    .status(201)
    .json(new ApiResponse(201, { connection, serverVersion: info.version }, "Connection saved"));
});

const listConnections = asyncHandler(async (req, res) => {
  const connections = await Connection.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, connections, "Connections fetched"));
});

const getConnection = asyncHandler(async (req, res) => {
  const connection = await getOwnedConnection(req.user._id, req.params.id);
  return res.status(200).json(new ApiResponse(200, connection, "Connection fetched"));
});

const updateConnection = asyncHandler(async (req, res) => {
  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const { password, ...fields } = readConnectionBody(req.body, connection);

  // Re-test with the new details (and the old password if no new one was given)
  const testConfig = { ...toAdapterConfig(connection), ...fields };
  if (password !== undefined) testConfig.password = password;
  await getAdapter(fields.type).test(testConfig);

  const previousType = connection.type;
  Object.assign(connection, fields);
  if (password !== undefined) connection.passwordEnc = encrypt(password);
  await connection.save();

  // Drop the old pool; a new one is created with the new details on next use
  await getAdapter(previousType).close(connection._id);

  return res.status(200).json(new ApiResponse(200, connection, "Connection updated"));
});

const deleteConnection = asyncHandler(async (req, res) => {
  const connection = await getOwnedConnection(req.user._id, req.params.id);

  await getAdapter(connection.type).close(connection._id);

  const monitorIds = await Monitor.find({ connection: connection._id }).distinct("_id");
  await Promise.all([
    SavedQuery.deleteMany({ connection: connection._id }),
    QueryHistory.deleteMany({ connection: connection._id }),
    MonitorRun.deleteMany({ monitor: { $in: monitorIds } }),
    Incident.deleteMany({ monitor: { $in: monitorIds } }),
    Monitor.deleteMany({ _id: { $in: monitorIds } }),
    SchemaSnapshot.deleteMany({ connection: connection._id }),
    connection.deleteOne(),
  ]);

  return res.status(200).json(new ApiResponse(200, {}, "Connection deleted"));
});

// Re-checks a saved connection (e.g. after the database restarted)
const testSavedConnection = asyncHandler(async (req, res) => {
  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const info = await getAdapter(connection.type).test(toAdapterConfig(connection));

  return res.status(200).json(new ApiResponse(200, info, "Connection successful"));
});

export {
  getDatabaseTypes,
  testUnsavedConnection,
  createConnection,
  listConnections,
  getConnection,
  updateConnection,
  deleteConnection,
  testSavedConnection,
};
