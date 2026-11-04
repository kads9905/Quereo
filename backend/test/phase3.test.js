import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { SAMPLE_DATABASES, startTestApp, stopTestApp, createUser } from "./helpers.js";
import { Monitor } from "../src/models/monitor.model.js";
import { Connection } from "../src/models/connection.model.js";
import { runDueMonitors, claimDueMonitor } from "../src/services/scheduler.service.js";

let app;
let webhook;

// A tiny local server that records every alert Quereo sends
const startWebhookReceiver = () =>
  new Promise((resolve) => {
    const received = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(req.url === "/broken" ? 500 : 200).end("ok");
      });
    });
    server.listen(0, () => {
      resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/hook` });
    });
  });

before(async () => {
  app = await startTestApp();
  webhook = await startWebhookReceiver();
});

after(async () => {
  webhook.server.close();
  await stopTestApp();
});

const CANCELLED_COUNT_SQL = "SELECT count(*) FROM orders WHERE status = 'cancelled'";

describe("monitors", () => {
  let api;
  let connectionId;

  before(async () => {
    api = await createUser(app);
    const res = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "shop" }).expect(201);
    connectionId = res.body.data.connection._id;
  });

  const createMonitor = (body) =>
    api.post("/api/monitors").send({
      connectionId,
      name: "Cancelled orders",
      sql: CANCELLED_COUNT_SQL,
      check: { type: "value", operator: "<", threshold: 100_000 },
      intervalSeconds: 60,
      ...body,
    });

  it("creates a monitor and runs it once straight away", async () => {
    const res = await createMonitor().expect(201);
    const { monitor, firstRun } = res.body.data;

    assert.equal(firstRun.passed, true);
    assert.equal(firstRun.value, 57143);
    assert.equal(monitor.status, "passing");
    assert.equal(monitor.lastValue, 57143);
  });

  it("validates monitor input", async () => {
    await createMonitor({ sql: "DELETE FROM orders" }).expect(400);
    await createMonitor({ check: { type: "value", operator: "~", threshold: 1 } }).expect(400);
    await createMonitor({ check: { type: "value", operator: "<", threshold: "10" } }).expect(400);
    await createMonitor({ intervalSeconds: 5 }).expect(400);
    await createMonitor({ webhookUrl: "ftp://example.com" }).expect(400);
  });

  it("supports row count and duration checks", async () => {
    const rows = await createMonitor({
      name: "Has products",
      sql: "SELECT id FROM products",
      check: { type: "row_count", operator: ">=", threshold: 500 },
    }).expect(201);
    assert.equal(rows.body.data.firstRun.value, 500);
    assert.equal(rows.body.data.firstRun.passed, true);

    const speed = await createMonitor({
      name: "Lookup is fast",
      sql: "SELECT * FROM orders WHERE id = 1",
      check: { type: "duration", operator: "<", threshold: 1_000 },
    }).expect(201);
    assert.equal(speed.body.data.firstRun.passed, true);
  });

  it("fails clearly when the value isn't a number", async () => {
    const res = await createMonitor({ name: "Text value", sql: "SELECT 'hello'" }).expect(201);
    assert.equal(res.body.data.firstRun.passed, false);
    assert.match(res.body.data.firstRun.error, /not a number/);
  });

  describe("incidents and alerts", () => {
    let monitorId;

    it("waits for alertAfter failures in a row before opening an incident", async () => {
      webhook.received.length = 0;
      const res = await createMonitor({
        name: "Too many cancellations",
        check: { type: "value", operator: "<", threshold: 10 },
        alertAfter: 2,
        webhookUrl: webhook.url,
      }).expect(201);
      monitorId = res.body.data.monitor._id;

      // First failure: no incident yet
      assert.equal(res.body.data.firstRun.passed, false);
      assert.equal(res.body.data.incident, null);
      assert.equal(webhook.received.length, 0);

      // Second failure in a row: incident + alert
      const second = await api.post(`/api/monitors/${monitorId}/run`).expect(200);
      assert.equal(second.body.data.incident.status, "open");
      assert.match(second.body.data.incident.reason, /value 57143 is not < 10/);

      assert.equal(webhook.received.length, 1);
      assert.equal(webhook.received[0].event, "opened");
      assert.match(webhook.received[0].text, /Too many cancellations is failing/);
    });

    it("doesn't alert again while the incident is still open", async () => {
      const third = await api.post(`/api/monitors/${monitorId}/run`).expect(200);
      assert.equal(third.body.data.incident.failureCount, 3);
      assert.equal(webhook.received.length, 1);

      const open = await api.get("/api/incidents?status=open").expect(200);
      assert.equal(open.body.data.filter((i) => i.monitor._id === monitorId).length, 1);
      assert.equal(open.body.data[0].monitor.name, "Too many cancellations");
    });

    it("resolves the incident and alerts when the check passes again", async () => {
      await api.patch(`/api/monitors/${monitorId}`).send({ check: { type: "value", operator: "<", threshold: 1e9 } }).expect(200);
      const res = await api.post(`/api/monitors/${monitorId}/run`).expect(200);

      assert.equal(res.body.data.run.passed, true);
      assert.equal(res.body.data.incident.status, "resolved");
      assert.equal(webhook.received.length, 2);
      assert.equal(webhook.received[1].event, "resolved");
      assert.match(webhook.received[1].text, /recovered/);

      const open = await api.get("/api/incidents?status=open").expect(200);
      assert.ok(!open.body.data.some((i) => i.monitor._id === monitorId));
    });

    it("sends test alerts and reports broken webhooks", async () => {
      await api.post(`/api/monitors/${monitorId}/test-alert`).expect(200);
      assert.equal(webhook.received.at(-1).event, "test");

      await api.patch(`/api/monitors/${monitorId}`).send({ webhookUrl: webhook.url.replace("/hook", "/broken") }).expect(200);
      const res = await api.post(`/api/monitors/${monitorId}/test-alert`).expect(400);
      assert.match(res.body.message, /HTTP 500/);
    });

    it("treats an unreachable database as a failure", async () => {
      // Break the connection directly in the database, as if the server went away
      const broken = await createMonitor({ name: "Broken db" }).expect(201);
      const brokenConnection = await api
        .post("/api/connections")
        .send({ ...SAMPLE_DATABASES.postgres, name: "soon broken" })
        .expect(201);
      const brokenId = brokenConnection.body.data.connection._id;
      await Monitor.updateOne({ _id: broken.body.data.monitor._id }, { connection: brokenId });
      await Connection.updateOne({ _id: brokenId }, { port: 1 });

      const res = await api.post(`/api/monitors/${broken.body.data.monitor._id}/run`).expect(200);
      assert.equal(res.body.data.run.passed, false);
      assert.match(res.body.data.run.error, /Could not connect/);
    });
  });

  describe("scheduler", () => {
    it("runs due monitors and schedules the next run", async () => {
      const res = await createMonitor({ name: "Scheduled", intervalSeconds: 120 }).expect(201);
      const id = res.body.data.monitor._id;
      await Monitor.updateOne({ _id: id }, { nextRunAt: new Date(Date.now() - 1000) });

      const before = Date.now();
      const count = await runDueMonitors();
      assert.ok(count >= 1);

      const monitor = await Monitor.findById(id);
      assert.equal(monitor.lockedUntil, null);
      const delay = monitor.nextRunAt.getTime() - before;
      assert.ok(delay > 110_000 && delay < 130_000, `next run should be ~120s away, was ${delay}ms`);

      const runs = await api.get(`/api/monitors/${id}/runs`).expect(200);
      assert.equal(runs.body.data.items.length, 2); // the first run on create + the scheduled one

      // Nothing is due any more
      assert.equal(await runDueMonitors(), 0);
    });

    it("never lets two workers claim the same monitor", async () => {
      await Monitor.updateMany({}, { nextRunAt: new Date(Date.now() + 3_600_000) });
      const res = await createMonitor({ name: "Race" }).expect(201);
      await Monitor.updateOne({ _id: res.body.data.monitor._id }, { nextRunAt: new Date(Date.now() - 1000) });

      const claims = await Promise.all(Array.from({ length: 5 }, () => claimDueMonitor()));
      assert.equal(claims.filter(Boolean).length, 1);

      // Claimed = locked, so it isn't picked up again until the lock expires
      await Monitor.updateOne({ _id: res.body.data.monitor._id }, { nextRunAt: new Date(Date.now() - 1000) });
      assert.equal(await claimDueMonitor(), null);

      // A lock left behind by a crashed server expires
      await Monitor.updateOne({ _id: res.body.data.monitor._id }, { lockedUntil: new Date(Date.now() - 1000) });
      assert.ok(await claimDueMonitor());
    });

    it("skips disabled monitors", async () => {
      await Monitor.updateMany({}, { nextRunAt: new Date(Date.now() + 3_600_000), lockedUntil: null });
      const res = await createMonitor({ name: "Paused" }).expect(201);
      const id = res.body.data.monitor._id;

      await api.patch(`/api/monitors/${id}`).send({ enabled: false }).expect(200);
      await Monitor.updateOne({ _id: id }, { nextRunAt: new Date(Date.now() - 1000) });
      assert.equal(await runDueMonitors(), 0);

      // Re-enabling schedules it right away
      await api.patch(`/api/monitors/${id}`).send({ enabled: true }).expect(200);
      assert.equal(await runDueMonitors(), 1);
    });
  });

  it("reports uptime and latency percentiles", async () => {
    const res = await createMonitor({ name: "Stats", check: { type: "value", operator: "<", threshold: 60_000 } }).expect(201);
    const id = res.body.data.monitor._id;
    await api.post(`/api/monitors/${id}/run`).expect(200);
    await api.patch(`/api/monitors/${id}`).send({ check: { type: "value", operator: "<", threshold: 50_000 } }).expect(200);
    await api.post(`/api/monitors/${id}/run`).expect(200);

    const stats = await api.get(`/api/monitors/${id}/stats?window=24h`).expect(200);
    const s = stats.body.data;

    assert.equal(s.totalRuns, 3);
    assert.equal(s.failedRuns, 1);
    assert.equal(s.uptimePct, 66.67);
    assert.ok(s.p95Ms >= s.p50Ms && s.p50Ms > 0);
    assert.equal(s.series.length, 1);

    await api.get(`/api/monitors/${id}/stats?window=1y`).expect(400);
  });

  it("keeps monitors private and removes them with their connection", async () => {
    const res = await createMonitor({ name: "Private" }).expect(201);
    const id = res.body.data.monitor._id;

    const other = await createUser(app);
    await other.get(`/api/monitors/${id}`).expect(404);
    await other.post(`/api/monitors/${id}/run`).expect(404);

    await api.delete(`/api/connections/${connectionId}`).expect(200);
    await api.get(`/api/monitors/${id}`).expect(404);
  });
});

describe("monitors on mysql", () => {
  it("runs the same checks against MySQL", async () => {
    const api = await createUser(app);
    const conn = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.mysql, name: "shop" }).expect(201);

    const res = await api
      .post("/api/monitors")
      .send({
        connectionId: conn.body.data.connection._id,
        name: "Cancelled orders",
        sql: CANCELLED_COUNT_SQL,
        check: { type: "value", operator: "==", threshold: 57143 },
      })
      .expect(201);

    assert.equal(res.body.data.firstRun.value, 57143);
    assert.equal(res.body.data.firstRun.passed, true);
  });
});
