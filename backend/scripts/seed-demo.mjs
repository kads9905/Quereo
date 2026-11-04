// Fills a demo account so every part of Quereo has something to show:
// four connections (PostgreSQL production + staging, MySQL, MongoDB), a mix of
// fast, slow and failing runs, monitors (one deliberately failing), saved
// queries and schema snapshots. Safe to run again: it reuses what exists.
//
//   npm run seed:demo                     (server on http://localhost:8000)
//   node scripts/seed-demo.mjs http://host:port
//
// Needs the sample databases from docker-compose.yml. Connections whose
// database isn't running are skipped. When the server was started with
// `npm run dev:local`, it also spreads extra history over the past weeks
// (straight into the in-memory database) so the Settings heatmap has shape.
import path from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

const BASE = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
const DEMO = { fullName: "Kadambari Walecha", email: "demo@quereo.test", password: "demo-pass-123" };
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sql = (s) => s.replace(/\s+/g, " ").trim();
const mongo = (cmd) => JSON.stringify(cmd);

const CONNECTIONS = [
  {
    body: { name: "shop · production", type: "postgres", host: "localhost", port: 5433, database: "shop", username: "postgres", password: "postgres", readOnly: true },
    queries: [
      sql("SELECT id, name, email FROM customers WHERE id = 42"),
      sql("SELECT id, total_cents, created_at FROM orders WHERE customer_id = 42"),
      sql("SELECT status, count(*) FROM orders GROUP BY status"),
      sql("SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50"),
      sql(`SELECT c.city, sum(o.total_cents) AS revenue FROM orders o JOIN customers c ON c.id = o.customer_id
           WHERE o.created_at > now() - interval '30 days' GROUP BY c.city ORDER BY revenue DESC`),
      sql("SELECT p.name, sum(oi.quantity) AS sold FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.name ORDER BY sold DESC LIMIT 10"),
      sql("SELECT id, email FROM customers WHERE email = 'customer7@example.com'"),
      sql("SELECT count(*) FROM order_item WHERE quantity > 2"), // typo: a failing run
    ],
    monitors: [
      { name: "customer lookup speed", sql: "SELECT id, total_cents FROM orders WHERE customer_id = 42", check: { type: "duration", operator: "<", threshold: 500 } },
      { name: "pending orders backlog", sql: "SELECT count(*) FROM orders WHERE status = 'pending'", check: { type: "value", operator: "<", threshold: 1000 } },
    ],
    saved: [["Revenue by city, 30 days", 4], ["Top selling products", 5]],
    snapshot: "before the orders index",
  },
  {
    body: { name: "shop · staging", type: "postgres", host: "localhost", port: 5433, database: "shop_staging", username: "postgres", password: "postgres", readOnly: false },
    queries: [
      sql("SELECT id, name, phone FROM customers LIMIT 20"),
      sql("SELECT count(*) FROM orders"),
      sql("SELECT * FROM orders WHERE customer_id = 7 ORDER BY created_at DESC"),
    ],
    monitors: [],
    saved: [["Customers with a phone", 0]],
    snapshot: "staging today",
  },
  {
    body: { name: "shop-mysql", type: "mysql", host: "127.0.0.1", port: 3307, database: "shop", username: "root", password: "mysql", readOnly: true },
    queries: [
      sql("SELECT id, total_cents, created_at FROM orders WHERE customer_id = 42"),
      sql("SELECT status, COUNT(*) FROM orders GROUP BY status"),
      sql("SELECT id, name FROM customers WHERE id = 100"),
      sql("SELECT * FROM orders WHERE status = 'shipped' ORDER BY created_at DESC LIMIT 25"),
      sql("SELECT category, AVG(price_cents) FROM products GROUP BY category"),
    ],
    monitors: [{ name: "orders are flowing", sql: "SELECT COUNT(*) FROM orders", check: { type: "row_count", operator: ">", threshold: 0 } }],
    saved: [["Shipped orders", 3]],
  },
  {
    body: { name: "shop-mongo", type: "mongodb", host: "127.0.0.1", port: 27018, database: "shop", username: "mongo", password: "mongo", readOnly: true },
    queries: [
      mongo({ find: "orders", filter: { customerId: 42 } }),
      mongo({ find: "customers", filter: { email: "customer7@example.com" } }),
      mongo({ count: "orders", query: { status: "cancelled" } }),
      mongo({ aggregate: "orders", pipeline: [{ $group: { _id: "$status", n: { $sum: 1 } } }], cursor: {} }),
      mongo({ find: "products", filter: { category: "books" }, limit: 20 }),
    ],
    monitors: [{ name: "mongo customer lookup", sql: mongo({ find: "customers", filter: { email: "customer7@example.com" } }), check: { type: "duration", operator: "<", threshold: 300 } }],
    saved: [["Orders per status", 3]],
  },
];

let cookie = "";
const api = async (method, route, body) => {
  const res = await fetch(`${BASE}/api${route}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json.data, message: json.message };
};

const log = (msg) => console.log(`  ${msg}`);

console.log(`Seeding the demo account on ${BASE}`);
const registered = await api("POST", "/users/register", DEMO);
if (!registered.ok && registered.status !== 409) throw new Error(`register: ${registered.message}`);
const login = await api("POST", "/users/login", { email: DEMO.email, password: DEMO.password });
if (!login.ok) throw new Error(`login: ${login.message}`);
const userId = login.data.user._id;
log(`${registered.ok ? "created" : "found"} ${DEMO.email}`);

const existing = (await api("GET", "/connections")).data;
const made = [];
for (const spec of CONNECTIONS) {
  let conn = existing.find((c) => c.name === spec.body.name);
  if (!conn) {
    const res = await api("POST", "/connections", spec.body);
    if (!res.ok) {
      log(`skipped ${spec.body.name}: ${res.message}`);
      continue;
    }
    // the create response wraps the connection; read it back from the list
    conn = (await api("GET", "/connections")).data.find((c) => c.name === spec.body.name);
    log(`connected ${spec.body.name}`);
  } else log(`kept ${spec.body.name}`);
  made.push({ spec, conn });
}
if (!made.length) throw new Error("No sample database answered. Start them with: docker compose up -d");

// runs: each query a few times, so the run tape and stats fill in
for (const { spec, conn } of made) {
  let ran = 0;
  for (let round = 0; round < 4; round++) {
    for (const q of spec.queries) {
      await api("POST", `/connections/${conn._id}/query`, { sql: q });
      ran++;
    }
  }
  log(`${ran} runs on ${conn.name}`);
}

// monitors, run a few times each so their strips and incidents have history
const monitors = (await api("GET", "/monitors")).data;
for (const { spec, conn } of made) {
  for (const m of spec.monitors) {
    let mon = monitors.find((x) => x.name === m.name && String(x.connection?._id ?? x.connection) === String(conn._id));
    if (!mon) {
      const res = await api("POST", "/monitors", { connectionId: conn._id, intervalSeconds: 300, ...m });
      if (!res.ok) {
        log(`monitor ${m.name} failed: ${res.message}`);
        continue;
      }
      mon = res.data.monitor ?? res.data;
    }
    for (let i = 0; i < 6; i++) await api("POST", `/monitors/${mon._id}/run`);
    log(`monitor ${m.name}`);
  }
}

// saved queries and snapshots
const saved = (await api("GET", "/saved-queries")).data ?? [];
const snapshots = (await api("GET", "/schema/snapshots")).data ?? [];
for (const { spec, conn } of made) {
  for (const [name, index] of spec.saved) {
    if (saved.some((s) => s.name === name)) continue;
    await api("POST", "/saved-queries", { connectionId: conn._id, name, sql: spec.queries[index] });
  }
  if (spec.snapshot && !snapshots.some((s) => s.name === spec.snapshot)) {
    const res = await api("POST", "/schema/snapshots", { connectionId: conn._id, name: spec.snapshot });
    log(res.ok ? `snapshot "${spec.snapshot}"` : `snapshot failed: ${res.message}`);
  }
}

// past weeks of history for the heatmap (in-memory dev server only)
const uriFile = path.join(backendDir, "node_modules", ".cache", "quereo-dev-mongo-uri.txt");
if (existsSync(uriFile)) {
  const { MongoClient, ObjectId } = await import("mongodb");
  const client = await new MongoClient(readFileSync(uriFile, "utf8").trim()).connect().catch(() => null);
  if (client) {
    const history = client.db("querylens").collection("queryhistories");
    const already = await history.countDocuments({ user: new ObjectId(userId), createdAt: { $lt: new Date(Date.now() - 86_400_000) } });
    if (!already) {
      const docs = [];
      let seed = 11;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let day = 1; day <= 84; day++) {
        const date = new Date(Date.now() - day * 86_400_000);
        const weekend = date.getDay() === 0 || date.getDay() === 6;
        if (rand() < (weekend ? 0.7 : 0.15)) continue; // quiet days
        const busy = Math.round((weekend ? 3 : 12) * (0.4 + rand() * 1.4) * (day < 30 ? 1.4 : 1));
        for (let n = 0; n < busy; n++) {
          const { spec, conn } = made[Math.floor(rand() * made.length)];
          const q = spec.queries[Math.floor(rand() * spec.queries.length)];
          const slow = rand() < 0.22;
          const failed = rand() < 0.04;
          const at = new Date(date);
          at.setHours(9 + Math.floor(rand() * 11), Math.floor(rand() * 60));
          docs.push({
            user: new ObjectId(userId),
            connection: new ObjectId(conn._id),
            sql: q,
            status: failed ? "error" : "ok",
            durationMs: failed ? 3 : slow ? 120 + rand() * 600 : 0.4 + rand() * 18,
            rowCount: failed ? undefined : Math.floor(rand() * 60),
            verdict: failed ? undefined : slow ? (rand() < 0.4 ? "SLOW" : "WARN") : "PASS",
            error: failed ? "relation does not exist" : undefined,
            createdAt: at,
          });
        }
      }
      await history.insertMany(docs);
      log(`${docs.length} past runs spread over 12 weeks`);
    }
    await client.close();
  }
}

console.log(`Done. Sign in as ${DEMO.email} / ${DEMO.password}`);
