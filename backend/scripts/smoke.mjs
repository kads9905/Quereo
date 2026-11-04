// End-to-end smoke test against a RUNNING Quereo server.
// Walks through a real user journey over HTTP, the way the frontend will:
// cookie login, all three database types, verdicts, the index advisor,
// schema diff, a monitor that alerts and recovers via the real scheduler, AI, logout.
//
//   npm run smoke                       (server on http://localhost:8000)
//   node scripts/smoke.mjs http://host:port
//
// Needs the sample databases from docker-compose.yml. Cleans up after itself.
import http from "http";

const BASE = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
const SAMPLES = {
  postgres: { type: "postgres", host: "localhost", port: 5433, database: "shop", username: "postgres", password: "postgres" },
  mysql: { type: "mysql", host: "127.0.0.1", port: 3307, database: "shop", username: "root", password: "mysql" },
  mongodb: { type: "mongodb", host: "127.0.0.1", port: 27018, database: "shop", username: "mongo", password: "mongo" },
};
const QUERIES = {
  postgres: "SELECT id, total_cents FROM orders WHERE customer_id = 42",
  mysql: "SELECT id, total_cents FROM orders WHERE customer_id = 42",
  mongodb: JSON.stringify({ find: "orders", filter: { customerId: 42 } }),
};

let cookie = "";
let failures = 0;

// fetch wrapper that keeps the login cookie, like a browser would
const api = async (method, path, body) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const json = await response.json().catch(() => ({}));
  return { status: response.status, data: json.data, message: json.message };
};

const step = async (name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`  ✔ ${name} (${Date.now() - started} ms)${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✖ ${name}: ${error.message}`);
  }
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const waitFor = async (check, { timeoutMs, everyMs = 2_000 }) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return null;
};

// Local webhook receiver, standing in for Slack
const alerts = [];
const webhook = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    alerts.push(JSON.parse(body));
    res.end("ok");
  });
});
await new Promise((resolve) => webhook.listen(0, resolve));
const webhookUrl = `http://127.0.0.1:${webhook.address().port}/alerts`;

console.log(`Quereo smoke test against ${BASE}\n`);
const connections = {};

console.log("Account");
await step("health check", async () => {
  const res = await api("GET", "/api/health");
  expect(res.status === 200 && res.data.mongo === "up", `got ${res.status}, mongo ${res.data?.mongo}`);
});
const email = `smoke${Date.now()}@test.dev`;
await step("register and log in (cookie)", async () => {
  expect((await api("POST", "/api/users/register", { fullName: "Smoke Test", email, password: "smoke-test-password" })).status === 201, "register failed");
  expect((await api("POST", "/api/users/login", { email, password: "smoke-test-password" })).status === 200, "login failed");
  expect(cookie.startsWith("accessToken="), "no auth cookie set");
});
await step("current user from cookie", async () => {
  const res = await api("GET", "/api/users/me");
  expect(res.status === 200 && res.data.email === email, `got ${res.status}`);
});

for (const [type, sample] of Object.entries(SAMPLES)) {
  console.log(`\n${type}`);
  await step("save connection", async () => {
    const res = await api("POST", "/api/connections", { ...sample, name: `smoke ${type}` });
    expect(res.status === 201, res.message);
    connections[type] = res.data.connection._id;
    return res.data.serverVersion.split(" ").slice(0, 2).join(" ");
  });
  await step("run query with verdict", async () => {
    const res = await api("POST", `/api/connections/${connections[type]}/query`, { sql: QUERIES[type] });
    expect(res.status === 200, res.message);
    expect(res.data.verdict.issues.some((issue) => issue.rule === "full_table_scan"), "missing full scan finding");
    return `${res.data.rowCount} rows, ${res.data.verdict.verdict}: ${res.data.verdict.summary}`;
  });
  await step("slow query list", async () => {
    const res = await api("GET", `/api/connections/${connections[type]}/slow-queries?limit=5`);
    expect(res.status === 200 && res.data.items.length > 0, res.message || "empty");
    return `${res.data.items.length} query shapes`;
  });
  await step("index suggestion", async () => {
    const res = await api("POST", `/api/connections/${connections[type]}/advisor/suggest`, { sql: QUERIES[type] });
    expect(res.status === 200 && res.data.suggestions.length === 1, res.message || "no suggestion");
    return res.data.suggestions[0].statement;
  });
  await step("schema", async () => {
    const res = await api("GET", `/api/connections/${connections[type]}/schema`);
    expect(res.status === 200 && res.data.tables.orders, res.message);
    return `${Object.keys(res.data.tables).length} tables`;
  });
}

console.log("\nIndex Advisor proof (postgres)");
await step("before/after trial", async () => {
  const writable = await api("POST", "/api/connections", { ...SAMPLES.postgres, name: "smoke writable", readOnly: false });
  connections.writable = writable.data.connection._id;
  const res = await api("POST", `/api/connections/${connections.writable}/advisor/try`, {
    sql: QUERIES.postgres, table: "orders", columns: ["customer_id"],
  });
  expect(res.status === 200 && res.data.verdict === "recommended", res.message || res.data?.message);
  return res.data.message;
});

console.log("\nSchema diff (postgres prod vs staging)");
await step("compare", async () => {
  const staging = await api("POST", "/api/connections", { ...SAMPLES.postgres, database: "shop_staging", name: "smoke staging" });
  connections.staging = staging.data.connection._id;
  const res = await api("POST", "/api/schema/diff", { source: { connectionId: connections.postgres }, target: { connectionId: connections.staging } });
  expect(res.status === 200 && res.data.summary.breaking > 0, res.message);
  return `${res.data.summary.breaking} breaking, ${res.data.summary.warnings} warnings, ${res.data.summary.info} info`;
});

console.log("\nMonitor with the real scheduler");
let monitorId;
await step("failing monitor opens an incident and alerts", async () => {
  const res = await api("POST", "/api/monitors", {
    connectionId: connections.postgres,
    name: "Smoke: cancelled orders",
    sql: "SELECT count(*) FROM orders WHERE status = 'cancelled'",
    check: { type: "value", operator: "<", threshold: 10 },
    intervalSeconds: 60,
    webhookUrl,
  });
  expect(res.status === 201 && res.data.incident?.status === "open", res.message || "no incident");
  monitorId = res.data.monitor._id;
  const alert = await waitFor(() => alerts.find((a) => a.event === "opened"), { timeoutMs: 5_000, everyMs: 200 });
  expect(alert, "no 'opened' webhook received");
  return alert.text;
});
await step("scheduler re-runs it and it recovers (takes up to ~75 s)", async () => {
  await api("PATCH", `/api/monitors/${monitorId}`, { check: { type: "value", operator: "<", threshold: 1_000_000 } });
  // The rule changed, so the monitor is due now; the scheduler ticks every 15 s
  const alert = await waitFor(() => alerts.find((a) => a.event === "resolved"), { timeoutMs: 75_000 });
  expect(alert, "the scheduler never ran the monitor");
  const stats = await api("GET", `/api/monitors/${monitorId}/stats`);
  return `${alert.text} | uptime ${stats.data.uptimePct}% over ${stats.data.totalRuns} runs`;
});

console.log("\nAI");
const aiStatus = await api("GET", "/api/ai/status");
if (aiStatus.data?.enabled) {
  await step(`natural language to SQL (${aiStatus.data.model})`, async () => {
    const res = await api("POST", `/api/connections/${connections.postgres}/ai/sql`, { question: "How many orders per status?" });
    expect(res.status === 200 && res.data.valid, res.message || res.data?.error);
    return res.data.sql.replace(/\s+/g, " ");
  });
} else {
  console.log("  - skipped: GROQ_API_KEY not set on the server");
}

console.log("\nCleanup");
await step("delete everything this test created", async () => {
  for (const id of Object.values(connections)) {
    expect((await api("DELETE", `/api/connections/${id}`)).status === 200, `could not delete ${id}`);
  }
});
await step("log out", async () => {
  await api("POST", "/api/users/logout");
  cookie = "";
  expect((await api("GET", "/api/users/me")).status === 401, "still logged in");
});

webhook.close();
console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
process.exit(failures ? 1 : 0);
