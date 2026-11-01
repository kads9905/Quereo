// Compares two schemas in the common format every adapter returns:
//   { engine, tables: { [name]: { columns: { [name]: { type, nullable, default } },
//                                  indexes: { [name]: { columns, unique, primary } } } } }
//
// "source" is the current state (e.g. production), "target" is the new one
// (e.g. staging, or the database after a migration). Every change describes
// going from source to target, with a severity:
//   breaking: can break an app that works against source (data or queries fail)
//   warning:  won't break, but may hurt (e.g. a dropped index = slower queries)
//   info:     safe

const change = (severity, kind, table, message, extra = {}) => ({ severity, kind, table, message, ...extra });

const sameColumns = (a, b) => a.length === b.length && a.every((column, i) => column === b[i]);

const diffColumns = (tableName, source, target) => {
  const changes = [];

  for (const [name, column] of Object.entries(target)) {
    if (source[name]) continue;
    // Existing INSERTs don't know about the new column, so it must accept being left out
    const breaking = !column.nullable && (column.default === null || column.default === undefined);
    changes.push(change(
      breaking ? "breaking" : "info",
      "column_added",
      tableName,
      breaking
        ? `New column ${tableName}.${name} is NOT NULL without a default: inserts that don't set it will fail`
        : `New column ${tableName}.${name} (${column.type})`,
      { column: name, to: column }
    ));
  }

  for (const [name, before] of Object.entries(source)) {
    const after = target[name];

    if (!after) {
      changes.push(change("breaking", "column_removed", tableName, `Column ${tableName}.${name} was removed`, { column: name, from: before }));
      continue;
    }

    if (before.type !== after.type) {
      changes.push(change(
        "breaking",
        "column_type_changed",
        tableName,
        `${tableName}.${name} changed type from ${before.type} to ${after.type}`,
        { column: name, from: before.type, to: after.type }
      ));
    }

    if (before.nullable !== after.nullable) {
      changes.push(change(
        after.nullable ? "info" : "breaking",
        "column_nullability_changed",
        tableName,
        after.nullable
          ? `${tableName}.${name} now allows NULL`
          : `${tableName}.${name} no longer allows NULL: existing NULLs and inserts without it will fail`,
        { column: name, from: before.nullable, to: after.nullable }
      ));
    }

    if ((before.default ?? null) !== (after.default ?? null)) {
      changes.push(change(
        "info",
        "column_default_changed",
        tableName,
        `${tableName}.${name} default changed from ${before.default ?? "none"} to ${after.default ?? "none"}`,
        { column: name, from: before.default ?? null, to: after.default ?? null }
      ));
    }
  }

  return changes;
};

const diffIndexes = (tableName, source, target) => {
  const changes = [];

  for (const [name, index] of Object.entries(target)) {
    if (!source[name]) {
      changes.push(change("info", "index_added", tableName, `New index ${name} on ${tableName} (${index.columns.join(", ")})`, { index: name, to: index }));
    }
  }

  for (const [name, before] of Object.entries(source)) {
    const after = target[name];

    if (!after) {
      changes.push(change(
        "warning",
        "index_removed",
        tableName,
        before.unique
          ? `Unique index ${name} on ${tableName} was removed: duplicates are no longer prevented`
          : `Index ${name} on ${tableName} was removed: queries that used it may get slower`,
        { index: name, from: before }
      ));
    } else if (!sameColumns(before.columns, after.columns) || before.unique !== after.unique) {
      changes.push(change(
        "warning",
        "index_changed",
        tableName,
        `Index ${name} on ${tableName} changed from (${before.columns.join(", ")}) to (${after.columns.join(", ")})`,
        { index: name, from: before, to: after }
      ));
    }
  }

  return changes;
};

const diffSchemas = (source, target) => {
  const changes = [];
  const tableNames = new Set([...Object.keys(source.tables), ...Object.keys(target.tables)]);

  for (const name of [...tableNames].sort()) {
    const before = source.tables[name];
    const after = target.tables[name];

    if (!before) {
      changes.push(change("info", "table_added", name, `New table ${name}`));
    } else if (!after) {
      changes.push(change("breaking", "table_removed", name, `Table ${name} was removed`));
    } else {
      changes.push(...diffColumns(name, before.columns, after.columns));
      changes.push(...diffIndexes(name, before.indexes, after.indexes));
    }
  }

  const count = (severity) => changes.filter((c) => c.severity === severity).length;
  const changedTables = new Set(
    changes.filter((c) => !["table_added", "table_removed"].includes(c.kind)).map((c) => c.table)
  );

  return {
    identical: changes.length === 0,
    summary: {
      tablesAdded: changes.filter((c) => c.kind === "table_added").length,
      tablesRemoved: changes.filter((c) => c.kind === "table_removed").length,
      tablesChanged: changedTables.size,
      breaking: count("breaking"),
      warnings: count("warning"),
      info: count("info"),
    },
    // Most serious first
    changes: [
      ...changes.filter((c) => c.severity === "breaking"),
      ...changes.filter((c) => c.severity === "warning"),
      ...changes.filter((c) => c.severity === "info"),
    ],
  };
};

// Finds a table from a plan node. Plans name tables without their schema,
// so "orders" matches "orders" (public) or "sales.orders".
const findTable = (schema, name) =>
  schema.tables[name] || Object.values(schema.tables).find((table) => table.name === name) || null;

export { diffSchemas, findTable };
