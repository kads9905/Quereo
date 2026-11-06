# Quereo

**Find the slow query, see why, and prove the fix.**

Quereo is a workspace for database performance. Connect a PostgreSQL, MySQL or MongoDB database, run queries and get a PASS / WARN / SLOW result with the reason, watch queries on a schedule, compare schemas, and prove an index helps before you add it.

## Features

| | |
|---|---|
| **Query workspace** | Run queries, keep history and saved queries. Read-only by default. |
| **Query verdict** | Every run is checked against its real execution plan: speed, full table scans, disk sorts, stale statistics. |
| **Slow query dashboard** | The most expensive queries, from the database's own statistics. |
| **Monitors** | A query plus a rule, run on a schedule. Incidents, Slack/Discord alerts, uptime and p95. |
| **Schema diff** | Compare two databases, or a snapshot with the live database. Breaking changes are flagged. |
| **Index Advisor** | Suggests an index from the plan, then proves it: measures the query, adds the index, measures again and removes it. Also finds unused indexes. |
| **AI** (Groq) | Explains a query in plain English, and turns questions into SQL or MongoDB queries, validated against the real database. |

All features work on **PostgreSQL, MySQL and MongoDB**.

## How it works

```
                 ┌──────────────────────────── Quereo API (Express) ───────────────────────────┐
  Frontend ───►  │  routes → controllers → services (verdict, advisor, schema diff, monitors, AI)  │
                 │                                   │                                              │
                 │                         adapters (one per database type)                         │
                 │                ┌──────────────────┼──────────────────┐                           │
                 │           postgres            mysql             mongodb                          │
                 └────────────────┼──────────────────┼──────────────────┼──────────────────────────┘
                                  ▼                  ▼                  ▼
                          user's databases (the ones being monitored and optimized)

  Quereo's own data (users, connections, monitors, history) → MongoDB (Atlas)
```

**Adapters.** Each database type implements the same small interface (`runQuery`, `explain`, `getSchema`, `getSlowQueries`, `tryIndex`...). Each adapter turns its database's plan into **one common format**, so the verdict rules, the Index Advisor and schema diff are written once and work everywhere. Adding a database type means writing one adapter file.

**Safety.**
- Read-only connections run every SQL query in a `READ ONLY` transaction. MongoDB has no such thing, so it uses an allow-list of read commands instead, and blocks `$out` and `$merge`.
- Only one statement can run at a time (`SELECT 1; DROP TABLE x` is rejected), and every query has a timeout. On MySQL, timed-out writes are also killed on the server.
- Saved database passwords are encrypted with AES-256-GCM, and every lookup is scoped to the logged-in user.
- `EXPLAIN ANALYZE` only runs on reads. Index trials on Postgres happen inside a transaction that is rolled back.
- The AI only gets structure (tables, columns, plans), never row data. Generated queries are never run automatically.

## Run it locally

Requirements: Node.js 20+. Docker is needed only for the sample databases used in testing.

```bash
cd backend
npm install
cp .env.example .env      # then fill in MONGODB_URI, ACCESS_TOKEN_SECRET, ENCRYPTION_KEY
npm run dev               # http://localhost:8000
```

The server checks its configuration at startup and refuses to start with a list of anything missing or invalid.

**Test UI:** in development, a plain test page is served at http://localhost:8000/. It covers login, connections, queries with verdicts, AI, slow queries, the Index Advisor, monitors and schema. To try it without Atlas, run `npm run dev:local`, which uses a temporary in-memory MongoDB for the app's own data.

### Sample databases (testing only)

`docker-compose.yml` starts a PostgreSQL, a MySQL and a MongoDB, each with the same demo store (20,000 customers, 400,000 orders). Some problems are deliberate, for the features to find: `orders.customer_id` has no index, and `idx_products_name` is never used.

```bash
docker compose up -d
```

| Database | Host | Port | Database | User / password |
|---|---|---|---|---|
| PostgreSQL | localhost | 5433 | `shop` (and `shop_staging`) | postgres / postgres |
| MySQL | 127.0.0.1 | 3307 | `shop` | root / mysql |
| MongoDB | 127.0.0.1 | 27018 | `shop` | mongo / mongo |

### Tests

```bash
npm test                 # 148 tests: unit + API tests against the sample databases (in-memory MongoDB for app data)
npm run smoke            # end-to-end journey against a running server (npm run dev first)
```

## Deploy (no Docker)

- **Backend:** Render (or any Node host). Start command `npm start`.
- **App data:** MongoDB Atlas, set as `MONGODB_URI`.
- **Production settings:** `NODE_ENV=production`, `CORS_ORIGIN` = your frontend URL (required), and a random `ACCESS_TOKEN_SECRET` of 32+ characters.
- The monitor scheduler runs inside the server. Monitors are claimed with an atomic update, so running more than one instance is safe.

## Writing queries

**PostgreSQL / MySQL:** plain SQL, one statement per run.

**MongoDB:** a database command as JSON (Extended JSON for dates and ids):

```json
{ "find": "orders", "filter": { "customerId": 42 }, "sort": { "createdAt": -1 }, "limit": 10 }
{ "aggregate": "orders", "pipeline": [{ "$group": { "_id": "$status", "n": { "$sum": 1 } } }] }
{ "count": "orders", "query": { "createdAt": { "$gte": { "$date": "2025-01-01T00:00:00Z" } } } }
{ "distinct": "orders", "key": "status" }
```

## API

All routes are under `/api` and need a login (an `accessToken` cookie, or `Authorization: Bearer <token>`), except register, login and health. Responses look like `{ success, message, data }`.

| Area | Endpoint | |
|---|---|---|
| Account | `POST /users/register` · `POST /users/login` · `GET /users/me` · `POST /users/logout` | |
| Connections | `GET /connections/types` | Supported database types |
| | `POST /connections/test` | Try details before saving |
| | `GET, POST /connections` · `GET, PATCH, DELETE /connections/:id` · `POST /connections/:id/test` | Saved after a successful test |
| Workspace | `POST /connections/:id/query` | `{ sql, maxRows?, timeoutMs?, slowMs?, verdict? }`: rows + verdict |
| | `GET, DELETE /history` · `GET, POST /saved-queries` · `PATCH, DELETE /saved-queries/:id` | History uses cursor pagination (`before`) |
| Performance | `POST /connections/:id/explain` | Full plan + verdict, no rows |
| | `GET /connections/:id/slow-queries?sortBy=total\|mean\|calls` | |
| Index Advisor | `POST /connections/:id/advisor/suggest` | `{ sql }` |
| | `POST /connections/:id/advisor/try` | `{ sql, table, columns }`, needs read-only off |
| | `GET /connections/:id/advisor/unused-indexes` | |
| Schema | `GET /connections/:id/schema` | |
| | `GET, POST /schema/snapshots` · `GET, DELETE /schema/snapshots/:id` | |
| | `POST /schema/diff` | `{ source: { connectionId \| snapshotId }, target: { ... } }` |
| Monitors | `GET, POST /monitors` · `GET, PATCH, DELETE /monitors/:id` | Created monitors run once immediately |
| | `POST /monitors/:id/run` · `POST /monitors/:id/test-alert` | |
| | `GET /monitors/:id/runs` · `GET /monitors/:id/stats?window=24h\|7d\|30d` | Uptime, p50/p95, chart series |
| | `GET /incidents?status=open\|resolved` | |
| AI | `GET /ai/status` | |
| | `POST /connections/:id/ai/explain` | `{ sql }` |
| | `POST /connections/:id/ai/sql` | `{ question }`: validated query, never executed |

## Known limits

- Alert webhooks can point at any URL, including internal addresses. A hosted multi-tenant version should block private networks.
- Logging out clears the cookie, but an access token stays valid until it expires (stateless JWT).
- MongoDB schemas are inferred from the newest 100 documents of each collection (first 200 collections).
- MySQL counts its own maintenance reads as index use, so reset its counters before trusting the unused-index list.

## Tech stack

Node.js, Express 5, MongoDB/Mongoose (app data), `pg`, `mysql2` and the `mongodb` driver (target databases), JWT + bcrypt, Groq (`openai/gpt-oss-120b`), `node:test` + Supertest.
