import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_DATABASES, startTestApp, stopTestApp, createUser } from "./helpers.js";
import { buildVerdict } from "../src/services/verdict.service.js";

let app;

before(async () => {
  app = await startTestApp();
});

after(stopTestApp);

describe("verdict rules", () => {
  const scan = (overrides) => ({
    operation: "Seq Scan",
    table: "orders",
    fullScan: true,
    filter: "(customer_id = 42)",
    rowsExamined: 400_000,
    rowsReturned: 20,
    estimatedRows: 20,
    actualRows: 20,
    sortOnDisk: false,
    ...overrides,
  });

  it("passes a fast query with no problems", () => {
    const v = buildVerdict({ sql: "SELECT id FROM orders WHERE id = 1", durationMs: 2, plan: { analyzed: true, nodes: [] }, engine: "postgres" });
    assert.equal(v.verdict, "PASS");
    assert.equal(v.summary, "4 of 4 checks passed");
  });

  it("warns about a full scan of a large table", () => {
    const v = buildVerdict({ sql: "SELECT id FROM orders WHERE customer_id = 42", durationMs: 30, plan: { analyzed: true, nodes: [scan()] } });
    assert.equal(v.verdict, "WARN");
    assert.equal(v.issues[0].rule, "full_table_scan");
    assert.match(v.issues[0].message, /read 400,000 rows to return 20/);
  });

  it("ignores full scans of small tables and scans without a filter", () => {
    const v = buildVerdict({
      sql: "SELECT count(*) FROM orders",
      durationMs: 30,
      plan: { analyzed: true, nodes: [scan({ rowsExamined: 500 }), scan({ filter: null })] },
    });
    assert.equal(v.verdict, "PASS");
  });

  it("marks queries over the limit as SLOW, even with other problems", () => {
    const v = buildVerdict({ sql: "SELECT 1", durationMs: 900, slowMs: 200, plan: { analyzed: true, nodes: [scan()] } });
    assert.equal(v.verdict, "SLOW");
    assert.equal(v.issues.length, 2);
  });

  it("flags stale statistics and disk sorts", () => {
    const v = buildVerdict({
      sql: "SELECT 1",
      durationMs: 10,
      engine: "postgres",
      plan: { analyzed: true, nodes: [scan({ fullScan: false, estimatedRows: 50, actualRows: 90_000 }), { sortOnDisk: true }] },
    });
    assert.deepEqual(v.issues.map((i) => i.rule).sort(), ["sort_on_disk", "stale_statistics"]);
  });

  it("gives tips without failing the verdict", () => {
    const v = buildVerdict({ sql: "SELECT * FROM customers", durationMs: 5, rowCount: 20_000, plan: { analyzed: true, nodes: [] } });
    assert.equal(v.verdict, "PASS");
    assert.deepEqual(v.tips.map((t) => t.rule), ["select_star", "large_result"]);
  });

  it("still gives a verdict from timing alone when there is no plan", () => {
    const v = buildVerdict({ sql: "SHOW TABLES", durationMs: 3, plan: null });
    assert.equal(v.verdict, "PASS");
    assert.equal(v.planAvailable, false);
    assert.equal(v.checks.length, 1);
  });
});

for (const [type, sample] of Object.entries(SAMPLE_DATABASES)) {
  describe(`${type}: query verdict and slow queries`, () => {
    let api;
    let connectionId;

    before(async () => {
      api = await createUser(app);
      const res = await api.post("/api/connections").send({ ...sample, name: "shop" }).expect(201);
      connectionId = res.body.data.connection._id;
    });

    const run = (body) => api.post(`/api/connections/${connectionId}/query`).send(body).expect(200);

    it("catches the missing index on orders.customer_id", async () => {
      const res = await run({ sql: "SELECT id, total_cents FROM orders WHERE customer_id = 42" });
      const { verdict } = res.body.data;

      assert.notEqual(verdict.verdict, "PASS");
      const scanIssue = verdict.issues.find((i) => i.rule === "full_table_scan");
      assert.ok(scanIssue, "expected a full table scan finding");
      assert.equal(scanIssue.table, "orders");
      assert.match(scanIssue.filter, /customer_id/);
    });

    it("passes a primary key lookup", async () => {
      const res = await run({ sql: "SELECT id, total_cents FROM orders WHERE id = 42" });
      assert.equal(res.body.data.verdict.verdict, "PASS");
      assert.equal(res.body.data.verdict.planAvailable, true);
    });

    it("uses the caller's slow threshold", async () => {
      const res = await run({ sql: "SELECT count(*) FROM orders WHERE status = 'paid'", slowMs: 1 });
      assert.equal(res.body.data.verdict.verdict, "SLOW");
    });

    it("can skip the verdict", async () => {
      const res = await run({ sql: "SELECT 1", verdict: false });
      assert.equal(res.body.data.verdict, null);
    });

    it("stores the verdict in history", async () => {
      const res = await api.get(`/api/history?connectionId=${connectionId}&limit=10`).expect(200);
      const verdicts = res.body.data.items.map((item) => item.verdict).filter(Boolean);
      assert.ok(verdicts.includes("PASS"));
      assert.ok(verdicts.includes("SLOW"));
    });

    it("explains a query without returning rows", async () => {
      const res = await api
        .post(`/api/connections/${connectionId}/explain`)
        .send({ sql: "SELECT * FROM orders WHERE status = 'paid'" })
        .expect(200);

      const { plan, verdict } = res.body.data;
      assert.equal(plan.analyzed, true);
      assert.ok(plan.nodes.some((node) => node.fullScan && node.table === "orders"));
      assert.ok(plan.raw);
      assert.ok(verdict.tips.some((t) => t.rule === "select_star"));
    });

    it("explains writes with estimates only, without running them", async () => {
      const writable = await api
        .post("/api/connections")
        .send({ ...sample, name: "shop writable", readOnly: false })
        .expect(201);

      const res = await api
        .post(`/api/connections/${writable.body.data.connection._id}/explain`)
        .send({ sql: "UPDATE orders SET status = 'paid' WHERE customer_id = 42" })
        .expect(200);

      const { plan, verdict } = res.body.data;
      assert.equal(plan.analyzed, false);
      assert.ok(verdict.issues.some((i) => i.rule === "full_table_scan"));

      // Nothing was changed
      const check = await run({ sql: "SELECT count(*) FROM orders WHERE customer_id = 42 AND status <> 'paid'" });
      assert.ok(Number(check.body.data.rows[0][0]) > 0);
    });

    it("rejects statements that can't be explained", async () => {
      await api.post(`/api/connections/${connectionId}/explain`).send({ sql: "SHOW TABLES" }).expect(400);
    });

    it("lists the most expensive queries from the database's own stats", async () => {
      for (let i = 0; i < 3; i++) {
        await run({ sql: `SELECT count(*) FROM orders WHERE customer_id = ${100 + i}`, verdict: false });
      }

      const res = await api.get(`/api/connections/${connectionId}/slow-queries?sortBy=total&limit=50`).expect(200);
      const { items } = res.body.data;

      // The 3 runs above differ only by a constant, so they're one query shape
      const shape = items.find((item) => /customer_id/.test(item.query) && /count/i.test(item.query));
      assert.ok(shape, "expected the customer_id query in the stats");
      assert.ok(shape.calls >= 3);
      assert.ok(shape.meanMs > 0);
      assert.equal(typeof shape.slow, "boolean");

      // Our own bookkeeping statements are filtered out
      assert.ok(!items.some((item) => /^\s*(BEGIN|COMMIT|SET|EXPLAIN|START TRANSACTION)/i.test(item.query)));
    });

    it("sorts slow queries by calls and validates sortBy", async () => {
      const res = await api.get(`/api/connections/${connectionId}/slow-queries?sortBy=calls`).expect(200);
      const calls = res.body.data.items.map((item) => item.calls);
      assert.deepEqual(calls, [...calls].sort((a, b) => b - a));

      await api.get(`/api/connections/${connectionId}/slow-queries?sortBy=random`).expect(400);
    });
  });
}
