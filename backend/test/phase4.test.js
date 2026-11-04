import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_DATABASES, startTestApp, stopTestApp, createUser } from "./helpers.js";
import { extractFilterColumns, orderIndexColumns } from "../src/services/advisor.service.js";
import { diffSchemas } from "../src/services/schema.service.js";

let app;

before(async () => {
  app = await startTestApp();
});

after(stopTestApp);

describe("filter column parsing", () => {
  const customerColumns = ["id", "name", "email", "city", "created_at"];
  const columnsOf = (filter, columns = customerColumns) => orderIndexColumns(extractFilterColumns(filter, columns));

  it("puts equality columns first and one range column last (Postgres)", () => {
    const filter = "((email ~~ 'cust%'::text) AND (city = 'Pune'::text) AND (created_at > (now() - '7 days'::interval)))";
    assert.deepEqual(columnsOf(filter), ["city", "email"]);
  });

  it("handles casts like (status)::text", () => {
    assert.deepEqual(columnsOf("((status)::text = 'paid'::text)", ["status"]), ["status"]);
  });

  it("handles MySQL's table-qualified conditions", () => {
    const filter = "((o.created_at > <cache>((now() - interval 7 day))) and (o.customer_id = 42))";
    assert.deepEqual(columnsOf(filter, ["id", "customer_id", "created_at"]), ["customer_id", "created_at"]);
  });

  it("ignores column names inside string literals", () => {
    assert.deepEqual(columnsOf("(name = 'city = Pune')"), ["name"]);
  });

  it("skips != because an index can't help", () => {
    assert.deepEqual(columnsOf("((city <> 'Pune'::text) AND (id = 4))"), ["id"]);
  });
});

describe("schema diff rules", () => {
  const schema = (columns, indexes = {}) => ({ engine: "postgres", tables: { users: { columns, indexes } } });
  const col = (type, nullable = true, def = null) => ({ type, nullable, default: def });

  it("reports nothing for identical schemas", () => {
    const s = schema({ id: col("integer", false) });
    assert.equal(diffSchemas(s, s).identical, true);
  });

  it("flags breaking changes and sorts them first", () => {
    const source = schema(
      { id: col("integer", false), email: col("text"), age: col("integer") },
      { users_email_key: { columns: ["email"], unique: true } }
    );
    const target = schema({
      id: col("bigint", false),
      email: col("text", false),
      nickname: col("text"),
      tenant_id: col("integer", false),
    });

    const diff = diffSchemas(source, target);
    const kinds = diff.changes.map((c) => `${c.severity}:${c.kind}:${c.column || c.index}`);

    assert.deepEqual(kinds.sort(), [
      "breaking:column_added:tenant_id",
      "breaking:column_nullability_changed:email",
      "breaking:column_removed:age",
      "breaking:column_type_changed:id",
      "info:column_added:nickname",
      "warning:index_removed:users_email_key",
    ]);
    assert.equal(diff.changes[0].severity, "breaking");
    assert.equal(diff.summary.breaking, 4);
  });
});

describe("postgres: schema diff", () => {
  let api;
  let shopId;
  let stagingId;

  before(async () => {
    api = await createUser(app);
    const shop = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "prod" }).expect(201);
    const staging = await api
      .post("/api/connections")
      .send({ ...SAMPLE_DATABASES.postgres, database: "shop_staging", name: "staging" })
      .expect(201);
    shopId = shop.body.data.connection._id;
    stagingId = staging.body.data.connection._id;
  });

  it("reads the live schema", async () => {
    const res = await api.get(`/api/connections/${shopId}/schema`).expect(200);
    const orders = res.body.data.tables.orders;

    assert.equal(res.body.data.engine, "postgres");
    assert.equal(orders.columns.customer_id.type, "integer");
    assert.equal(orders.columns.customer_id.nullable, false);
    assert.deepEqual(orders.indexes.orders_pkey.columns, ["id"]);
    assert.ok(orders.rowEstimate > 300_000);
  });

  it("compares production with staging", async () => {
    const res = await api
      .post("/api/schema/diff")
      .send({ source: { connectionId: shopId }, target: { connectionId: stagingId } })
      .expect(200);

    const changes = res.body.data.changes.map((c) => `${c.severity}:${c.kind}:${c.table}`);
    assert.ok(changes.includes("breaking:table_removed:order_items"));
    assert.ok(changes.includes("breaking:column_type_changed:orders"));
    assert.ok(changes.includes("info:column_added:customers"));
    assert.ok(changes.includes("info:index_added:orders"));
    assert.equal(res.body.data.source.name, "prod");

    const typeChange = res.body.data.changes.find((c) => c.kind === "column_type_changed");
    assert.equal(typeChange.from, "integer");
    assert.equal(typeChange.to, "numeric(12,2)");
  });

  it("saves snapshots and compares them with the live database", async () => {
    const created = await api.post("/api/schema/snapshots").send({ connectionId: shopId, name: "before release" }).expect(201);
    assert.equal(created.body.data.schemaJson, undefined);
    assert.ok(created.body.data.tableCount >= 4);

    const diff = await api
      .post("/api/schema/diff")
      .send({ source: { snapshotId: created.body.data._id }, target: { connectionId: shopId } })
      .expect(200);
    assert.equal(diff.body.data.identical, true);

    const list = await api.get(`/api/schema/snapshots?connectionId=${shopId}`).expect(200);
    assert.equal(list.body.data.length, 1);

    const full = await api.get(`/api/schema/snapshots/${created.body.data._id}`).expect(200);
    assert.ok(full.body.data.schema.tables.orders);

    const other = await createUser(app);
    await other.get(`/api/schema/snapshots/${created.body.data._id}`).expect(404);

    await api.delete(`/api/schema/snapshots/${created.body.data._id}`).expect(200);
  });

  it("refuses to compare different database types", async () => {
    const mysql = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.mysql, name: "mysql" }).expect(201);
    const res = await api
      .post("/api/schema/diff")
      .send({ source: { connectionId: shopId }, target: { connectionId: mysql.body.data.connection._id } })
      .expect(400);
    assert.match(res.body.message, /Can't compare/);

    await api.post("/api/schema/diff").send({ source: {}, target: { connectionId: shopId } }).expect(400);
  });
});

for (const [type, sample] of Object.entries(SAMPLE_DATABASES)) {
  describe(`${type}: index advisor`, () => {
    let api;
    let readOnlyId;
    let writableId;
    const SLOW_SQL = "SELECT id, total_cents FROM orders WHERE customer_id = 42";

    before(async () => {
      api = await createUser(app);
      const ro = await api.post("/api/connections").send({ ...sample, name: "read only" }).expect(201);
      const rw = await api.post("/api/connections").send({ ...sample, name: "writable", readOnly: false }).expect(201);
      readOnlyId = ro.body.data.connection._id;
      writableId = rw.body.data.connection._id;

      // Start MySQL's index usage counters from zero (see docker/mysql/01-shop.sql)
      if (type === "mysql") {
        await api
          .post(`/api/connections/${writableId}/query`)
          .send({ sql: "TRUNCATE TABLE performance_schema.table_io_waits_summary_by_index_usage", verdict: false })
          .expect(200);
      }
    });

    it("suggests an index for a full table scan", async () => {
      const res = await api
        .post(`/api/connections/${readOnlyId}/advisor/suggest`)
        .send({ sql: "SELECT id FROM orders WHERE created_at > '2020-01-01' AND customer_id = 42" })
        .expect(200);

      const [suggestion] = res.body.data.suggestions;
      assert.equal(suggestion.table, "orders");
      // Equality column first, range column last
      assert.deepEqual(suggestion.columns, ["customer_id", "created_at"]);
      assert.match(suggestion.statement, /CREATE INDEX .*orders.*customer_id.*created_at/);
      assert.ok(suggestion.rowsExamined > 100_000);
    });

    it("has nothing to suggest for an indexed lookup", async () => {
      const res = await api.post(`/api/connections/${readOnlyId}/advisor/suggest`).send({ sql: "SELECT * FROM orders WHERE id = 7" }).expect(200);
      assert.equal(res.body.data.suggestions.length, 0);
    });

    it("proves the index helps, then removes it", async () => {
      const res = await api
        .post(`/api/connections/${writableId}/advisor/try`)
        .send({ sql: SLOW_SQL, table: "orders", columns: ["customer_id"] })
        .expect(200);

      const trial = res.body.data;
      assert.equal(trial.indexUsed, true);
      assert.equal(trial.verdict, "recommended");
      assert.ok(trial.speedup >= 2, `expected a big speed-up, got ${trial.speedup}x`);
      assert.ok(trial.before.rowsExamined > 100_000);
      assert.ok(trial.after.rowsExamined < 100);
      assert.equal(trial.indexKept, false);

      // The temporary index is gone
      const schema = await api.get(`/api/connections/${writableId}/schema`).expect(200);
      const indexNames = Object.keys(schema.body.data.tables.orders.indexes);
      assert.ok(!indexNames.some((name) => name.startsWith("querylens_trial")), indexNames.join(","));
    });

    it("reports when an index wouldn't be used", async () => {
      // 6 in 7 orders match, and total_cents isn't in the index, so reading the
      // whole table is cheaper than jumping between index and table for each row.
      // (count(*) alone would NOT work here: MySQL can count from the small index
      // without touching the table - a "covering index" - and that is faster.)
      const res = await api
        .post(`/api/connections/${writableId}/advisor/try`)
        .send({ sql: "SELECT id, total_cents FROM orders WHERE status <> 'pending'", table: "orders", columns: ["status"] })
        .expect(200);
      assert.notEqual(res.body.data.verdict, "recommended");
    });

    it("only runs trials on writable connections, with real tables and columns", async () => {
      const body = { sql: SLOW_SQL, table: "orders", columns: ["customer_id"] };

      const ro = await api.post(`/api/connections/${readOnlyId}/advisor/try`).send(body).expect(400);
      assert.match(ro.body.message, /read-only/);

      await api.post(`/api/connections/${writableId}/advisor/try`).send({ ...body, table: "nope" }).expect(400);
      await api.post(`/api/connections/${writableId}/advisor/try`).send({ ...body, columns: ["customer_id; DROP TABLE orders"] }).expect(400);
      await api.post(`/api/connections/${writableId}/advisor/try`).send({ ...body, sql: "DELETE FROM orders" }).expect(400);
    });

    it("lists unused indexes, but never primary keys or unique indexes", async () => {
      const res = await api.get(`/api/connections/${readOnlyId}/advisor/unused-indexes`).expect(200);
      const names = res.body.data.unused.map((index) => index.index);

      assert.ok(names.includes("idx_products_name"), names.join(","));
      assert.ok(!names.some((name) => /pkey|PRIMARY|email/i.test(name)));
      assert.match(res.body.data.unused[0].dropStatement, /DROP INDEX/);
      assert.ok(res.body.data.statsSince);
    });
  });
}
