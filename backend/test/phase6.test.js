import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { SAMPLE_MONGO, SAMPLE_DATABASES, startTestApp, stopTestApp, createUser } from "./helpers.js";
import { extractFilterFields } from "../src/adapters/mongodb.adapter.js";

let app;
let api;
let readOnlyId;
let writableId;

const q = (value) => JSON.stringify(value);
const run = (id, query, extra = {}) => api.post(`/api/connections/${id}/query`).send({ sql: q(query), ...extra });

before(async () => {
  app = await startTestApp();
  api = await createUser(app);
  const ro = await api.post("/api/connections").send({ ...SAMPLE_MONGO, name: "mongo shop" }).expect(201);
  const rw = await api.post("/api/connections").send({ ...SAMPLE_MONGO, name: "mongo writable", readOnly: false }).expect(201);
  readOnlyId = ro.body.data.connection._id;
  writableId = rw.body.data.connection._id;
});

after(stopTestApp);

describe("mongodb: filter fields", () => {
  it("reads fields straight from the filter document", () => {
    const fields = extractFilterFields({
      $and: [{ createdAt: { $gt: new Date() } }, { customerId: { $eq: 42 } }],
      status: { $in: ["paid", "shipped"] },
      city: { $ne: "Pune" },
    });
    assert.deepEqual(fields.map((f) => `${f.column}:${f.kind}`), ["createdAt:range", "customerId:equality", "status:equality"]);
  });
});

describe("mongodb: connections and queries", () => {
  it("tests the connection and reports the version", async () => {
    const ok = await api.post("/api/connections/test").send(SAMPLE_MONGO).expect(200);
    assert.match(ok.body.data.version, /^MongoDB 8/);

    const bad = await api.post("/api/connections/test").send({ ...SAMPLE_MONGO, password: "wrong" }).expect(400);
    assert.match(bad.body.message, /Could not connect/);
  });

  it("runs find and turns documents into columns and rows", async () => {
    const res = await run(readOnlyId, { find: "customers", filter: {}, sort: { _id: 1 }, limit: 3 }).expect(200);
    const result = res.body.data;

    assert.equal(result.command, "FIND");
    assert.deepEqual(result.columns, ["_id", "name", "email", "city", "createdAt"]);
    assert.equal(result.rows[0][1], "Customer 1");
    assert.match(result.rows[0][4], /^\d{4}-\d\d-\d\dT/); // dates become ISO strings
  });

  it("caps the documents returned", async () => {
    const res = await run(readOnlyId, { find: "customers", filter: {} }, { maxRows: 10 }).expect(200);
    assert.equal(res.body.data.rows.length, 10);
    assert.equal(res.body.data.truncated, true);
  });

  it("runs aggregate, count and distinct", async () => {
    const agg = await run(readOnlyId, {
      aggregate: "orders",
      pipeline: [{ $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
    }).expect(200);
    assert.deepEqual(agg.body.data.rows[0], ["delivered", 171429]);

    const count = await run(readOnlyId, { count: "orders", query: { status: "cancelled" } }).expect(200);
    assert.deepEqual(count.body.data.rows, [[57143]]);

    const distinct = await run(readOnlyId, { distinct: "orders", key: "status" }).expect(200);
    assert.equal(distinct.body.data.rows.length, 5);
  });

  it("understands Extended JSON dates", async () => {
    const res = await run(readOnlyId, { find: "orders", filter: { createdAt: { $gte: { $date: "2000-01-01T00:00:00Z" } } }, limit: 1 }).expect(200);
    assert.equal(res.body.data.rows.length, 1);
  });

  it("rejects things that aren't supported commands", async () => {
    const notJson = await api.post(`/api/connections/${readOnlyId}/query`).send({ sql: "db.orders.find()" }).expect(400);
    assert.match(notJson.body.message, /JSON command/);

    await run(readOnlyId, { dropDatabase: 1 }).expect(400);
    await run(readOnlyId, { find: 5 }).expect(400);
  });

  it("blocks writes on read-only connections, including $out", async () => {
    const insert = await run(readOnlyId, { insert: "products", documents: [{ name: "x" }] }).expect(400);
    assert.match(insert.body.message, /read-only/);

    const out = await run(readOnlyId, { aggregate: "orders", pipeline: [{ $match: {} }, { $out: "stolen" }] }).expect(400);
    assert.match(out.body.message, /read-only/);

    const count = await run(readOnlyId, { count: "products", query: {} }).expect(200);
    assert.deepEqual(count.body.data.rows, [[500]]);
  });

  it("allows writes when read-only is off", async () => {
    // Sets the price to the value it already has, so the sample data stays the same
    const res = await run(writableId, {
      update: "products",
      updates: [{ q: { _id: 1 }, u: { $set: { priceCents: 137 } } }],
    }).expect(200);
    assert.equal(res.body.data.command, "UPDATE");
    assert.equal(res.body.data.rowCount, 1);
  });

  it("cancels queries that run past the timeout", async () => {
    const res = await run(readOnlyId, {
      aggregate: "orders",
      pipeline: [{ $lookup: { from: "orders", localField: "customerId", foreignField: "customerId", as: "same" } }],
    }, { timeoutMs: 300 }).expect(400);
    assert.match(res.body.message, /cancelled/);
  });
});

describe("mongodb: verdict, explain and slow queries", () => {
  it("catches a collection scan", async () => {
    const res = await run(readOnlyId, { find: "orders", filter: { customerId: 42 } }).expect(200);
    const scan = res.body.data.verdict.issues.find((issue) => issue.rule === "full_table_scan");

    assert.ok(scan, "expected a full scan finding");
    assert.equal(scan.table, "orders");
    assert.match(scan.message, /read 400,000 rows to return 20/);
  });

  it("passes an _id lookup", async () => {
    const res = await run(readOnlyId, { find: "orders", filter: { _id: 42 } }).expect(200);
    assert.equal(res.body.data.verdict.verdict, "PASS");
  });

  it("explains aggregations", async () => {
    const res = await api
      .post(`/api/connections/${readOnlyId}/explain`)
      .send({ sql: q({ aggregate: "orders", pipeline: [{ $match: { status: "paid" } }, { $group: { _id: "$customerId", total: { $sum: "$totalCents" } } }] }) })
      .expect(200);

    const scan = res.body.data.plan.nodes.find((node) => node.fullScan);
    assert.equal(scan.table, "orders");
    assert.equal(scan.rowsExamined, 400_000);
  });

  it("explains writes without applying them", async () => {
    const res = await api
      .post(`/api/connections/${writableId}/explain`)
      .send({ sql: q({ delete: "orders", deletes: [{ q: { customerId: 42 }, limit: 0 }] }) })
      .expect(200);
    assert.equal(res.body.data.plan.analyzed, false);

    const count = await run(readOnlyId, { count: "orders", query: { customerId: 42 } }).expect(200);
    assert.deepEqual(count.body.data.rows, [[20]]);
  });

  it("lists slow queries from the profiler, grouped by shape", async () => {
    for (const id of [777, 778, 779]) {
      await run(readOnlyId, { find: "orders", filter: { customerId: id } }, { verdict: false }).expect(200);
    }

    const res = await api.get(`/api/connections/${readOnlyId}/slow-queries?sortBy=calls&limit=50`).expect(200);
    const { items } = res.body.data;

    const shape = items.find((item) => /"customerId"/.test(item.query) && /"find"/.test(item.query));
    assert.ok(shape, "expected the customerId find in the profiler stats");
    assert.ok(shape.calls >= 3);
    assert.ok(shape.noIndexUsed >= 3);
    // Quereo's own internal commands are left out
    assert.ok(!items.some((item) => /(quereo|querylens):internal|\$indexStats|"explain"/.test(item.query)));
  });
});

describe("mongodb: schema and index advisor", () => {
  it("infers the schema from sample documents", async () => {
    const res = await api.get(`/api/connections/${readOnlyId}/schema`).expect(200);
    const orders = res.body.data.tables.orders;

    assert.equal(res.body.data.inferred, true);
    assert.equal(orders.columns.customerId.type, "int");
    assert.equal(orders.columns.createdAt.type, "date");
    assert.equal(orders.columns.customerId.nullable, false);
    assert.equal(orders.sampled, 100);
    assert.deepEqual(res.body.data.tables.customers.indexes.email_1.columns, ["email"]);
  });

  it("compares a snapshot with the live database, but not with SQL databases", async () => {
    const snapshot = await api.post("/api/schema/snapshots").send({ connectionId: readOnlyId, name: "mongo v1" }).expect(201);
    const diff = await api
      .post("/api/schema/diff")
      .send({ source: { snapshotId: snapshot.body.data._id }, target: { connectionId: readOnlyId } })
      .expect(200);
    assert.equal(diff.body.data.identical, true);

    const pg = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "pg" }).expect(201);
    await api
      .post("/api/schema/diff")
      .send({ source: { connectionId: readOnlyId }, target: { connectionId: pg.body.data.connection._id } })
      .expect(400);
  });

  const SLOW_FIND = { find: "orders", filter: { createdAt: { $gt: { $date: "2020-01-01T00:00:00Z" } }, customerId: 42 } };

  it("suggests an index, equality field first (ESR rule)", async () => {
    const res = await api.post(`/api/connections/${readOnlyId}/advisor/suggest`).send({ sql: q(SLOW_FIND) }).expect(200);
    const [suggestion] = res.body.data.suggestions;

    assert.equal(suggestion.table, "orders");
    assert.deepEqual(suggestion.columns, ["customerId", "createdAt"]);
    assert.match(suggestion.statement, /createIndex\(\{"customerId":1,"createdAt":1\}/);
  });

  it("proves the index helps, then drops it", async () => {
    const res = await api
      .post(`/api/connections/${writableId}/advisor/try`)
      .send({ sql: q(SLOW_FIND), table: "orders", columns: ["customerId", "createdAt"] })
      .expect(200);

    assert.equal(res.body.data.indexUsed, true);
    assert.equal(res.body.data.verdict, "recommended");
    assert.equal(res.body.data.before.rowsExamined, 400_000);
    assert.ok(res.body.data.after.rowsExamined <= 20);

    const schema = await api.get(`/api/connections/${writableId}/schema`).expect(200);
    assert.deepEqual(Object.keys(schema.body.data.tables.orders.indexes), ["_id_"]);
  });

  it("rejects unsafe field names in index trials", async () => {
    await api
      .post(`/api/connections/${writableId}/advisor/try`)
      .send({ sql: q(SLOW_FIND), table: "orders", columns: ["$where"] })
      .expect(400);
  });

  it("lists unused indexes, never _id or unique ones", async () => {
    const res = await api.get(`/api/connections/${readOnlyId}/advisor/unused-indexes`).expect(200);
    const names = res.body.data.unused.map((index) => index.index);

    assert.ok(names.includes("idx_products_name"), names.join(","));
    assert.ok(!names.includes("_id_"));
    assert.ok(!names.includes("email_1"));
    assert.match(res.body.data.unused[0].dropStatement, /dropIndex/);
  });
});

describe("mongodb: monitors", () => {
  it("monitors a count", async () => {
    const res = await api
      .post("/api/monitors")
      .send({
        connectionId: readOnlyId,
        name: "Cancelled orders",
        sql: q({ count: "orders", query: { status: "cancelled" } }),
        check: { type: "value", operator: "==", threshold: 57143 },
      })
      .expect(201);
    assert.equal(res.body.data.firstRun.passed, true);
  });

  it("counts every matching document for row_count checks", async () => {
    const res = await api
      .post("/api/monitors")
      .send({
        connectionId: readOnlyId,
        name: "All products",
        sql: q({ find: "products", filter: {} }),
        check: { type: "row_count", operator: "==", threshold: 500 },
      })
      .expect(201);
    assert.equal(res.body.data.firstRun.value, 500);
  });

  it("refuses monitors that write", async () => {
    await api
      .post("/api/monitors")
      .send({
        connectionId: readOnlyId,
        name: "Bad",
        sql: q({ delete: "orders", deletes: [{ q: {}, limit: 0 }] }),
        check: { type: "value", operator: "<", threshold: 1 },
      })
      .expect(400);
  });
});

describe("mongodb: AI", () => {
  let groq;

  before(async () => {
    const replies = [];
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: "fake", choices: [{ message: { content: JSON.stringify(replies.shift()) } }] }));
      });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    groq = { server, replies, requests };
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => groq.server.close());

  it("writes a MongoDB command, validates it and fixes it if needed", async () => {
    const answer = (sql) => ({ sql: q(sql), explanation: "", assumptions: [], cannotAnswer: false });
    groq.replies.push(answer({ select: "orders" }));
    groq.replies.push(answer({ aggregate: "orders", pipeline: [{ $group: { _id: "$status", n: { $sum: 1 } } }] }));

    const res = await api.post(`/api/connections/${readOnlyId}/ai/sql`).send({ question: "Orders per status" }).expect(200);

    assert.equal(res.body.data.valid, true);
    assert.equal(res.body.data.attempts, 2);
    assert.match(res.body.data.sql, /"aggregate":"orders"/);

    const firstPrompt = groq.requests[0].messages.map((m) => m.content).join("\n");
    assert.match(firstPrompt, /MongoDB database command in JSON/);
    assert.match(firstPrompt, /Collection orders \(~400,000 documents/);
    assert.match(groq.requests[1].messages.at(-1).content, /Unsupported command "select"/);
    // MongoDB uses best-effort schema mode, because "sql" may be a string or an object
    assert.equal(groq.requests[0].response_format.json_schema.strict, false);
  });

  it("accepts the command as a JSON object instead of a string", async () => {
    groq.replies.push({
      sql: { count: "orders", query: { status: "cancelled" } },
      explanation: "",
      assumptions: [],
      cannotAnswer: false,
    });

    const res = await api.post(`/api/connections/${readOnlyId}/ai/sql`).send({ question: "Cancelled orders?" }).expect(200);
    assert.equal(res.body.data.valid, true);
    assert.equal(res.body.data.sql, '{"count":"orders","query":{"status":"cancelled"}}');
  });
});
