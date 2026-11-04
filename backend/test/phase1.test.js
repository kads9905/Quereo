import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { SAMPLE_DATABASES, startTestApp, stopTestApp, createUser } from "./helpers.js";
import { Connection } from "../src/models/connection.model.js";

let app;

before(async () => {
  app = await startTestApp();
});

after(stopTestApp);

describe("auth", () => {
  it("registers, logs in and returns the current user", async () => {
    const api = await createUser(app, "alice@test.dev");
    const me = await api.get("/api/users/me").expect(200);

    assert.equal(me.body.data.email, "alice@test.dev");
    assert.equal(me.body.data.password, undefined);
  });

  it("rejects duplicate emails, wrong passwords and missing tokens", async () => {
    await createUser(app, "bob@test.dev");

    await request(app)
      .post("/api/users/register")
      .send({ fullName: "Bob", email: "BOB@test.dev", password: "another-password" })
      .expect(409);

    await request(app).post("/api/users/login").send({ email: "bob@test.dev", password: "wrong-password" }).expect(401);
    await request(app).get("/api/users/me").expect(401);
  });
});

describe("connections", () => {
  it("lists the supported database types", async () => {
    const api = await createUser(app);
    const res = await api.get("/api/connections/types").expect(200);

    assert.deepEqual(res.body.data.map((t) => t.type).sort(), ["mongodb", "mysql", "postgres"]);
  });

  it("rejects unknown types and missing fields", async () => {
    const api = await createUser(app);

    await api.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "x", type: "oracle" }).expect(400);
    await api.post("/api/connections").send({ type: "postgres", name: "x" }).expect(400);
  });

  it("keeps connections private to their owner", async () => {
    const owner = await createUser(app);
    const other = await createUser(app);

    const created = await owner.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "private" }).expect(201);
    const id = created.body.data.connection._id;

    await other.get(`/api/connections/${id}`).expect(404);
    await other.post(`/api/connections/${id}/query`).send({ sql: "SELECT 1" }).expect(404);

    const list = await other.get("/api/connections").expect(200);
    assert.equal(list.body.data.length, 0);
  });

  it("rate-limits connection attempts", async () => {
    const api = await createUser(app);
    // Port 1 on localhost refuses instantly
    const target = { ...SAMPLE_DATABASES.postgres, host: "127.0.0.1", port: 1 };

    for (let i = 0; i < 20; i++) {
      await api.post("/api/connections/test").send(target).expect(400);
    }
    await api.post("/api/connections/test").send(target).expect(429);
  });
});

// The same behaviour is checked against every adapter
for (const [type, sample] of Object.entries(SAMPLE_DATABASES)) {
  describe(`${type} adapter`, () => {
    let api;
    let connectionId;
    let writableId;

    before(async () => {
      api = await createUser(app);
    });

    it("tests a connection before saving it", async () => {
      const ok = await api.post("/api/connections/test").send(sample).expect(200);
      assert.match(ok.body.data.version, type === "postgres" ? /PostgreSQL/ : /MySQL/);

      const bad = await api.post("/api/connections/test").send({ ...sample, password: "wrong" }).expect(400);
      assert.match(bad.body.message, /Could not connect/);
    });

    it("saves a connection with the password encrypted", async () => {
      const res = await api.post("/api/connections").send({ ...sample, name: `${type} shop` }).expect(201);
      const { connection } = res.body.data;
      connectionId = connection._id;

      assert.equal(connection.readOnly, true);
      assert.equal(connection.passwordEnc, undefined);
      assert.equal(connection.password, undefined);

      const stored = await Connection.findById(connectionId).select("+passwordEnc");
      assert.notEqual(stored.passwordEnc, sample.password);
      assert.ok(!stored.passwordEnc.includes(sample.password));
    });

    it("refuses to save a connection that doesn't work", async () => {
      await api.post("/api/connections").send({ ...sample, name: "broken", password: "wrong" }).expect(400);
    });

    it("runs a SELECT and returns columns and rows", async () => {
      const res = await api
        .post(`/api/connections/${connectionId}/query`)
        .send({ sql: "SELECT id, name, city FROM customers ORDER BY id LIMIT 3" })
        .expect(200);

      const result = res.body.data;
      assert.deepEqual(result.columns, ["id", "name", "city"]);
      assert.equal(result.rows.length, 3);
      assert.equal(result.rows[0][1], "Customer 1");
      assert.equal(result.command, "SELECT");
      assert.ok(result.durationMs >= 0);
    });

    it("keeps duplicate column names", async () => {
      const res = await api.post(`/api/connections/${connectionId}/query`).send({ sql: "SELECT 1 AS a, 2 AS a" }).expect(200);
      assert.deepEqual(res.body.data.columns, ["a", "a"]);
      assert.deepEqual(res.body.data.rows[0].map(Number), [1, 2]);
    });

    it("caps the number of rows returned", async () => {
      const res = await api
        .post(`/api/connections/${connectionId}/query`)
        .send({ sql: "SELECT id FROM customers", maxRows: 10 })
        .expect(200);

      assert.equal(res.body.data.rows.length, 10);
      assert.equal(res.body.data.truncated, true);
      assert.equal(res.body.data.rowCount, 20000);
    });

    it("blocks writes and DDL on read-only connections", async () => {
      const update = await api
        .post(`/api/connections/${connectionId}/query`)
        .send({ sql: "UPDATE products SET price_cents = 1 WHERE id = 1" })
        .expect(400);
      assert.match(update.body.message, /read-only/);

      const ddl = await api
        .post(`/api/connections/${connectionId}/query`)
        .send({ sql: "CREATE TABLE should_not_exist (id int)" })
        .expect(400);
      assert.match(ddl.body.message, /read-only/);
    });

    it("rejects more than one statement", async () => {
      await api
        .post(`/api/connections/${connectionId}/query`)
        .send({ sql: "SELECT 1; DROP TABLE products" })
        .expect(400);

      // products must still be there
      await api.post(`/api/connections/${connectionId}/query`).send({ sql: "SELECT count(*) FROM products" }).expect(200);
    });

    it("returns the database's own message for bad SQL", async () => {
      const res = await api.post(`/api/connections/${connectionId}/query`).send({ sql: "SELEC 1" }).expect(400);
      assert.match(res.body.message, /syntax/i);
    });

    it("cancels queries that run past the timeout", async () => {
      const res = await api
        .post(`/api/connections/${connectionId}/query`)
        .send({
          sql: "SELECT count(*) FROM orders a JOIN orders b ON a.status = b.status",
          timeoutMs: 500,
        })
        .expect(400);
      assert.match(res.body.message, /cancelled/);

      // The pool still works afterwards
      await api.post(`/api/connections/${connectionId}/query`).send({ sql: "SELECT 1" }).expect(200);
    });

    it("allows writes when read-only is turned off", async () => {
      const res = await api
        .post("/api/connections")
        .send({ ...sample, name: `${type} writable`, readOnly: false })
        .expect(201);
      writableId = res.body.data.connection._id;

      // A no-op update: proves writes work without changing the sample data
      const update = await api
        .post(`/api/connections/${writableId}/query`)
        .send({ sql: "UPDATE products SET price_cents = price_cents WHERE id = 1" })
        .expect(200);
      assert.equal(update.body.data.command, "UPDATE");
    });

    if (type === "mysql") {
      it("kills a timed-out write on the server, not just in our client", async () => {
        const res = await api
          .post(`/api/connections/${writableId}/query`)
          .send({ sql: "UPDATE products SET price_cents = price_cents + SLEEP(5) * 0 WHERE id = 1", timeoutMs: 500 })
          .expect(400);
        assert.match(res.body.message, /cancelled/);

        // Without KILL QUERY the UPDATE would still be sleeping on the server
        const check = await api
          .post(`/api/connections/${connectionId}/query`)
          .send({
            sql: "SELECT count(*) FROM information_schema.processlist WHERE info LIKE 'UPDATE products SET price_cents%'",
          })
          .expect(200);
        assert.equal(Number(check.body.data.rows[0][0]), 0);
      });
    }

    it("records successful and failed runs in history, newest first", async () => {
      const res = await api.get(`/api/history?connectionId=${connectionId}`).expect(200);
      const items = res.body.data.items;

      assert.ok(items.length >= 8);
      assert.ok(items.some((item) => item.status === "error"));
      assert.ok(items.some((item) => item.status === "ok"));
      assert.ok(new Date(items[0].createdAt) >= new Date(items[1].createdAt));
    });

    it("paginates history with a cursor", async () => {
      const page1 = await api.get(`/api/history?connectionId=${connectionId}&limit=3`).expect(200);
      assert.equal(page1.body.data.items.length, 3);
      assert.ok(page1.body.data.nextCursor);

      const page2 = await api
        .get(`/api/history?connectionId=${connectionId}&limit=3&before=${page1.body.data.nextCursor}`)
        .expect(200);
      const firstIds = new Set(page1.body.data.items.map((i) => i._id));
      assert.ok(page2.body.data.items.every((i) => !firstIds.has(i._id)));
    });

    it("keeps the old password when an update fails", async () => {
      await api.patch(`/api/connections/${connectionId}`).send({ password: "wrong" }).expect(400);
      await api.post(`/api/connections/${connectionId}/test`).expect(200);

      const renamed = await api.patch(`/api/connections/${connectionId}`).send({ name: `${type} renamed` }).expect(200);
      assert.equal(renamed.body.data.name, `${type} renamed`);
      await api.post(`/api/connections/${connectionId}/query`).send({ sql: "SELECT 1" }).expect(200);
    });

    it("saves, edits and deletes queries", async () => {
      const created = await api
        .post("/api/saved-queries")
        .send({ connectionId, name: "Top cities", sql: "SELECT city, count(*) FROM customers GROUP BY city" })
        .expect(201);
      const id = created.body.data._id;

      await api.patch(`/api/saved-queries/${id}`).send({ name: "Customers per city" }).expect(200);

      const list = await api.get(`/api/saved-queries?connectionId=${connectionId}`).expect(200);
      assert.equal(list.body.data[0].name, "Customers per city");

      await api.delete(`/api/saved-queries/${id}`).expect(200);
      await api.delete(`/api/saved-queries/${id}`).expect(404);
    });

    it("deletes a connection with its history", async () => {
      await api.delete(`/api/connections/${writableId}`).expect(200);
      await api.get(`/api/connections/${writableId}`).expect(404);

      const history = await api.get(`/api/history?connectionId=${writableId}`).expect(200);
      assert.equal(history.body.data.items.length, 0);
    });
  });
}
