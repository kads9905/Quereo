import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { SAMPLE_DATABASES, startTestApp, stopTestApp, createUser } from "./helpers.js";

let app;
let groq;

// A fake Groq API: records every request and answers with scripted replies
const startFakeGroq = () =>
  new Promise((resolve) => {
    const state = { requests: [], replies: [] };
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        state.requests.push({ headers: req.headers, body: JSON.parse(body) });
        const reply = state.replies.shift() ?? { status: 500, json: { error: "no scripted reply" } };
        res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reply.json ?? {
          model: "openai/gpt-oss-120b",
          choices: [{ message: { role: "assistant", content: JSON.stringify(reply.answer) } }],
          usage: { total_tokens: 123 },
        }));
      });
    });
    server.listen(0, () => {
      state.url = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, state });
    });
  });

before(async () => {
  app = await startTestApp();
  groq = await startFakeGroq();
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_BASE_URL = groq.state.url;
  delete process.env.GROQ_MODEL;
});

after(async () => {
  groq.server.close();
  await stopTestApp();
});

beforeEach(() => {
  groq.state.requests.length = 0;
  groq.state.replies.length = 0;
});

const reply = (answer) => groq.state.replies.push({ answer });
const lastPrompt = () => groq.state.requests.at(-1).body.messages.map((m) => m.content).join("\n");

const sqlAnswer = (sql, extra = {}) => ({ sql, explanation: "test", assumptions: [], cannotAnswer: false, ...extra });

describe("AI on postgres", () => {
  let api;
  let connectionId;

  before(async () => {
    api = await createUser(app);
    const res = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "shop" }).expect(201);
    connectionId = res.body.data.connection._id;
  });

  describe("explain", () => {
    it("sends the facts (plan, findings, tables) and returns the explanation", async () => {
      reply({
        summary: "Reads every order to find one customer's orders.",
        problems: [{ title: "Full table scan", explanation: "No index on customer_id." }],
        fixes: [{ title: "Add an index", explanation: "Lets Postgres jump to the rows.", sql: "CREATE INDEX ON orders (customer_id);" }],
      });

      const res = await api
        .post(`/api/connections/${connectionId}/ai/explain`)
        .send({ sql: "SELECT id, total_cents FROM orders WHERE customer_id = 42" })
        .expect(200);

      assert.equal(res.body.data.explanation.problems[0].title, "Full table scan");
      assert.equal(res.body.data.verdict.verdict, "WARN");

      const request = groq.state.requests[0];
      assert.equal(request.headers.authorization, "Bearer test-key");
      assert.equal(request.body.model, "openai/gpt-oss-120b");
      assert.equal(request.body.response_format.type, "json_schema");
      assert.equal(request.body.response_format.json_schema.strict, true);

      const prompt = lastPrompt();
      assert.match(prompt, /Database: PostgreSQL/);
      assert.match(prompt, /Table orders/);
      assert.match(prompt, /customer_id integer NOT NULL/);
      assert.match(prompt, /Full table scan on orders/);
      // Only tables in the plan are described
      assert.doesNotMatch(prompt, /Table products/);
    });

    it("never sends row data", async () => {
      reply({ summary: "ok", problems: [], fixes: [] });
      await api
        .post(`/api/connections/${connectionId}/ai/explain`)
        .send({ sql: "SELECT name, email FROM customers WHERE city = 'Pune' LIMIT 5" })
        .expect(200);

      const prompt = lastPrompt();
      assert.doesNotMatch(prompt, /Customer \d+/);
      assert.doesNotMatch(prompt, /@example\.com/);
    });
  });

  describe("natural language to SQL", () => {
    it("returns validated SQL without running it", async () => {
      reply(sqlAnswer("SELECT city, count(*) AS customers FROM customers GROUP BY city;"));

      const res = await api
        .post(`/api/connections/${connectionId}/ai/sql`)
        .send({ question: "How many customers are in each city?" })
        .expect(200);

      const data = res.body.data;
      assert.equal(data.sql, "SELECT city, count(*) AS customers FROM customers GROUP BY city");
      assert.equal(data.valid, true);
      assert.equal(data.attempts, 1);
      assert.ok(data.verdict);

      // The prompt describes every table, so the model can pick the right ones
      const prompt = lastPrompt();
      assert.match(prompt, /Table customers/);
      assert.match(prompt, /Table orders/);
      assert.match(prompt, /Question: How many customers are in each city\?/);
      assert.match(prompt, /PostgreSQL/);
    });

    it("sends the database error back so the model can fix its SQL", async () => {
      reply(sqlAnswer("SELECT town FROM customers"));
      reply(sqlAnswer("SELECT city FROM customers LIMIT 100"));

      const res = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "List customer cities" }).expect(200);

      assert.equal(res.body.data.valid, true);
      assert.equal(res.body.data.attempts, 2);
      assert.equal(res.body.data.sql, "SELECT city FROM customers LIMIT 100");

      const retryPrompt = lastPrompt();
      assert.match(retryPrompt, /The database rejected that SQL: column "town" does not exist/);
    });

    it("never runs or returns as valid a statement that writes", async () => {
      reply(sqlAnswer("DELETE FROM orders"));
      reply(sqlAnswer("DROP TABLE orders"));

      const res = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "Remove all orders" }).expect(200);
      assert.equal(res.body.data.valid, false);
      assert.match(res.body.data.error, /Only a single SELECT/);

      const check = await api.post(`/api/connections/${connectionId}/query`).send({ sql: "SELECT count(*) FROM orders" }).expect(200);
      assert.equal(Number(check.body.data.rows[0][0]), 400_000);
    });

    it("warns when the generated SQL will do a full table scan", async () => {
      reply(sqlAnswer("SELECT id, total_cents FROM orders WHERE customer_id = 42"));
      const res = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "Orders of customer 42" }).expect(200);
      assert.ok(res.body.data.verdict.issues.some((issue) => issue.rule === "full_table_scan"));
    });

    it("says so when the question can't be answered", async () => {
      reply(sqlAnswer("", { cannotAnswer: true, explanation: "There is no shipping data." }));
      const res = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "Average shipping time?" }).expect(200);
      assert.equal(res.body.data.sql, null);
      assert.equal(res.body.data.cannotAnswer, true);
    });

    it("validates the question", async () => {
      await api.post(`/api/connections/${connectionId}/ai/sql`).send({}).expect(400);
      await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "x".repeat(1_001) }).expect(400);
    });
  });

  describe("errors and limits", () => {
    // A fresh user, so earlier tests don't use up the 10-per-minute AI limit
    before(async () => {
      api = await createUser(app);
      const res = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "shop" }).expect(201);
      connectionId = res.body.data.connection._id;
    });

    it("turns Groq errors into clear messages", async () => {
      groq.state.replies.push({ status: 429, json: { error: "rate limited" } });
      const limited = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "anything" }).expect(429);
      assert.match(limited.body.message, /rate limit/);

      groq.state.replies.push({ status: 401, json: { error: "bad key" } });
      const badKey = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "anything" }).expect(502);
      assert.match(badKey.body.message, /API key/);
    });

    it("reports when AI isn't set up", async () => {
      const key = process.env.GROQ_API_KEY;
      delete process.env.GROQ_API_KEY;
      try {
        const status = await api.get("/api/ai/status").expect(200);
        assert.equal(status.body.data.enabled, false);

        const res = await api.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "anything" }).expect(503);
        assert.match(res.body.message, /GROQ_API_KEY/);
      } finally {
        process.env.GROQ_API_KEY = key;
      }
    });

    it("keeps other users out", async () => {
      const other = await createUser(app);
      await other.post(`/api/connections/${connectionId}/ai/sql`).send({ question: "anything" }).expect(404);
      assert.equal(groq.state.requests.length, 0);
    });

    it("rate-limits AI calls per user", async () => {
      const user = await createUser(app);
      const conn = await user.post("/api/connections").send({ ...SAMPLE_DATABASES.postgres, name: "shop" }).expect(201);
      const id = conn.body.data.connection._id;

      for (let i = 0; i < 10; i++) {
        await user.post(`/api/connections/${id}/ai/sql`).send({}).expect(400);
      }
      await user.post(`/api/connections/${id}/ai/sql`).send({}).expect(429);
    });
  });
});

describe("AI on mysql", () => {
  it("writes MySQL SQL and validates it against MySQL", async () => {
    const api = await createUser(app);
    const conn = await api.post("/api/connections").send({ ...SAMPLE_DATABASES.mysql, name: "shop" }).expect(201);
    reply(sqlAnswer("SELECT status, COUNT(*) AS orders FROM orders GROUP BY status"));

    const res = await api
      .post(`/api/connections/${conn.body.data.connection._id}/ai/sql`)
      .send({ question: "Orders per status" })
      .expect(200);

    assert.equal(res.body.data.valid, true);
    assert.match(lastPrompt(), /MySQL/);
    assert.match(lastPrompt(), /customer_id int NOT NULL/);
  });
});
