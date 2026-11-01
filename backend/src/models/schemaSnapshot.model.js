import mongoose, { Schema } from "mongoose";

// A saved copy of a database's structure, to compare against later
// ("what changed since last week's release?")
const schemaSnapshotSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    connection: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    engine: { type: String, required: true },
    tableCount: Number,
    // Stored as a JSON string: table and column names can contain "." or
    // start with "$", which MongoDB treats specially in field names
    schemaJson: { type: String, required: true, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schemaSnapshotSchema.index({ user: 1, connection: 1, createdAt: -1 });

export const SchemaSnapshot = mongoose.model("SchemaSnapshot", schemaSnapshotSchema);
