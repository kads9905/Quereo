import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank } from "../utils/validate.js";
import { getAdapter } from "../adapters/index.js";
import { SchemaSnapshot } from "../models/schemaSnapshot.model.js";
import { getOwnedConnection, toAdapterConfig } from "../services/connection.service.js";
import { diffSchemas } from "../services/schema.service.js";

const loadLiveSchema = async (userId, connectionId) => {
  const connection = await getOwnedConnection(userId, connectionId, { withSecret: true });
  const schema = await getAdapter(connection.type).getSchema(connection, toAdapterConfig(connection));
  return { connection, schema };
};

const getOwnedSnapshot = async (userId, id, { withSchema = false } = {}) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid snapshot id");
  const query = SchemaSnapshot.findOne({ _id: id, user: userId });
  if (withSchema) query.select("+schemaJson");
  const snapshot = await query;
  if (!snapshot) throw new ApiError(404, "Snapshot not found");
  return snapshot;
};

// GET /api/connections/:id/schema - the live structure of a database
const getSchema = asyncHandler(async (req, res) => {
  const { schema } = await loadLiveSchema(req.user._id, req.params.id);
  return res.status(200).json(new ApiResponse(200, schema, "Schema fetched"));
});

// POST /api/schema/snapshots { connectionId, name }
const createSnapshot = asyncHandler(async (req, res) => {
  const { connectionId, name } = req.body || {};
  if (isBlank(name)) throw new ApiError(400, "name is required");

  const { connection, schema } = await loadLiveSchema(req.user._id, connectionId);
  const snapshot = await SchemaSnapshot.create({
    user: req.user._id,
    connection: connection._id,
    name,
    engine: schema.engine,
    tableCount: Object.keys(schema.tables).length,
    schemaJson: JSON.stringify(schema),
  });

  const { schemaJson, ...summary } = snapshot.toObject();
  return res.status(201).json(new ApiResponse(201, summary, "Snapshot saved"));
});

const listSnapshots = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.connectionId) {
    if (!mongoose.isValidObjectId(req.query.connectionId)) throw new ApiError(400, "Invalid connectionId");
    filter.connection = req.query.connectionId;
  }
  const snapshots = await SchemaSnapshot.find(filter).sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, snapshots, "Snapshots fetched"));
});

const getSnapshot = asyncHandler(async (req, res) => {
  const snapshot = await getOwnedSnapshot(req.user._id, req.params.id, { withSchema: true });
  const { schemaJson, ...summary } = snapshot.toObject();
  return res.status(200).json(new ApiResponse(200, { ...summary, schema: JSON.parse(schemaJson) }, "Snapshot fetched"));
});

const deleteSnapshot = asyncHandler(async (req, res) => {
  const snapshot = await getOwnedSnapshot(req.user._id, req.params.id);
  await snapshot.deleteOne();
  return res.status(200).json(new ApiResponse(200, {}, "Snapshot deleted"));
});

// A side of a comparison is either a live connection or a saved snapshot
const resolveSide = async (userId, side, label) => {
  if (side?.connectionId) {
    const { connection, schema } = await loadLiveSchema(userId, side.connectionId);
    return { schema, description: { type: "connection", id: connection._id, name: connection.name } };
  }
  if (side?.snapshotId) {
    const snapshot = await getOwnedSnapshot(userId, side.snapshotId, { withSchema: true });
    return {
      schema: JSON.parse(snapshot.schemaJson),
      description: { type: "snapshot", id: snapshot._id, name: snapshot.name, createdAt: snapshot.createdAt },
    };
  }
  throw new ApiError(400, `${label} needs a connectionId or a snapshotId`);
};

// POST /api/schema/diff { source: { connectionId | snapshotId }, target: { ... } }
// e.g. source = production, target = staging: "what will change when staging ships?"
const diffSchema = asyncHandler(async (req, res) => {
  const source = await resolveSide(req.user._id, req.body?.source, "source");
  const target = await resolveSide(req.user._id, req.body?.target, "target");

  // Type names differ between databases (int4 vs int), so only same-type comparisons make sense
  if (source.schema.engine !== target.schema.engine) {
    throw new ApiError(400, `Can't compare a ${source.schema.engine} schema with a ${target.schema.engine} schema`);
  }

  const diff = diffSchemas(source.schema, target.schema);
  return res.status(200).json(
    new ApiResponse(200, { source: source.description, target: target.description, ...diff }, "Schemas compared")
  );
});

export { getSchema, createSnapshot, listSnapshots, getSnapshot, deleteSnapshot, diffSchema };
