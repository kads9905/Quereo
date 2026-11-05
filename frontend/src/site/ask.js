// What the FAQ console knows about Quereo. Each topic has the words that point
// to it and an answer grounded in what the product actually does. answer()
// scores every topic against the question and returns the best match.

const TOPICS = [
  {
    keys: ["drop", "delete", "truncate", "update", "insert", "alter", "grant", "destroy"],
    tag: "BLOCKED",
    tone: "slow",
    text: "Not on a read-only connection. Every query runs one statement at a time inside a read-only transaction, so writes and stacked statements are refused. Nice try though.",
  },
  {
    keys: ["what is quereo", "what's quereo", "what does quereo", "quereo do", "about quereo", "tell me about", "who are you", "overview", "purpose"],
    tag: "ANSWER",
    text: "Quereo is a query workspace for PostgreSQL, MySQL and MongoDB. It reads the plan behind every query, tells you in plain words why it's slow, tests the fix on your own data, and keeps watching it with monitors.",
  },
  {
    keys: ["database", "databases", "postgres", "postgresql", "mysql", "mongo", "mongodb", "engine", "support", "aurora", "rds", "supabase", "neon", "atlas"],
    tag: "ANSWER",
    text: "PostgreSQL, MySQL and MongoDB, wherever they're hosted: RDS, Aurora, Supabase, Neon, Atlas, Cloud SQL or your own box. Each engine has its own adapter, and every feature works on all three.",
  },
  {
    keys: ["verdict", "verdicts", "pass", "warn", "check", "checks", "plan", "explain", "analyze", "slow", "why is", "checkout", "full scan", "seq scan"],
    tag: "ANSWER",
    text: "Every run gets a verdict: PASS, WARN or SLOW. Quereo reads the real execution plan and checks for things like full scans of large tables, sorts spilling to disk and bad row estimates, then tells you which step caused it.",
  },
  {
    keys: ["slow query", "slow queries", "expensive", "pg_stat_statements", "performance_schema", "profiler", "top queries", "most time"],
    tag: "ANSWER",
    text: "The slow-queries list comes from your database's own statistics: pg_stat_statements on PostgreSQL, performance_schema on MySQL and the profiler on MongoDB, ranked by total time, average time or calls.",
  },
  {
    keys: ["index", "indexes", "advisor", "trial", "trials", "suggest", "faster", "fix", "speed up", "287"],
    tag: "ANSWER",
    text: "The Index Advisor finds filtered full scans in the plan and suggests the index that's missing. An index trial builds it, times the query again, then removes it. On the sample data that was 287× faster: 14.4 ms down to 0.05 ms.",
  },
  {
    keys: ["unused", "unused indexes", "unused index", "never used", "waste", "drop index", "bloat"],
    tag: "FOUND",
    tone: "warn",
    text: "Quereo lists indexes that have never been read since stats were last reset, with their size and a ready-made DROP statement. Primary keys and unique indexes are left out, since they enforce rules.",
  },
  {
    keys: ["trial cost", "lock", "locks", "staging", "replica", "risk"],
    tag: "ANSWER",
    text: "Building an index briefly locks writes on that table, so run trials on staging or a replica. Quereo only allows them on connections where you've turned read-only off yourself.",
  },
  {
    keys: ["monitor", "monitors", "watch", "schedule", "uptime", "p95", "incident", "incidents", "every minute"],
    tag: "ANSWER",
    text: "A monitor runs a query on a schedule, from every minute to every day, and checks its row count, a value or how long it took. Failures open an incident; recovery closes it. You get uptime, p50 and p95 per monitor.",
  },
  {
    keys: ["alert", "alerts", "slack", "discord", "webhook", "notify", "notification", "ping"],
    tag: "ANSWER",
    text: "Give a monitor a Slack or Discord webhook (or any URL) and Quereo posts one clear message when it fails and when it recovers. You can send a test alert to check it's wired up.",
  },
  {
    keys: ["schema", "diff", "snapshot", "breaking", "migration", "compare"],
    tag: "ANSWER",
    text: "Schema diff compares two live databases, or one against a saved snapshot, and flags changes as breaking, warning or info: dropped tables and columns, changed types, removed indexes. It works on inferred MongoDB schemas too.",
  },
  {
    keys: ["ai", "groq", "english", "natural language", "write query", "generate", "sql for me", "llm", "gpt", "model"],
    tag: "ANSWER",
    text: "Ask in English and Quereo writes the SQL or MongoDB query, checks it with EXPLAIN (which doesn't run it), and fixes it once if the database rejects it. It never runs anything on its own. It can also explain a slow query in plain words.",
  },
  {
    keys: ["see my data", "my data", "rows", "privacy", "private", "sent", "share", "leak"],
    tag: "ANSWER",
    text: "Your rows never leave your database. The AI only gets table and column names, the query and its plan. Results you query are shown to you and then dropped; Quereo doesn't store them.",
  },
  {
    keys: ["read-only", "read only", "safe", "safety", "production", "change my data", "harm", "break", "writes"],
    tag: "ANSWER",
    text: "Yes. Connections are read-only by default: every query runs in a read-only transaction, one statement at a time. You'd have to switch read-only off for a connection before anything could change.",
  },
  {
    keys: ["password", "encrypt", "encrypted", "credentials", "secure", "security", "aes", "hash"],
    tag: "ANSWER",
    text: "Database passwords are encrypted with AES-256-GCM and never sent back to the browser. Your account password is stored as a bcrypt hash, and sessions use an httpOnly cookie.",
  },
  {
    keys: ["history", "retention", "kept", "keep", "how long", "90 days"],
    tag: "ANSWER",
    text: "Query history and monitor runs are kept for 90 days, then deleted automatically. Deleting a connection removes everything attached to it: history, saved queries, monitors and snapshots.",
  },
  {
    keys: ["setup", "set up", "start", "connect", "install", "onboard", "how do i", "get started", "minute"],
    tag: "ANSWER",
    text: "Create a read-only user, add the connection (host, port, database, user) and run a query. Quereo tests the connection before saving it. There's nothing to install on your database server, and the sample databases fill in with one click.",
  },
  {
    keys: ["enable", "extension", "requirement", "prerequisite", "turn on"],
    tag: "ANSWER",
    text: "Only the slow-query list needs something switched on: pg_stat_statements on PostgreSQL, performance_schema on MySQL, the profiler on MongoDB. Verdicts, plans, index trials and monitors work without them.",
  },
  {
    keys: ["deploy", "host", "self-host", "self host", "run quereo", "server", "docker", "where does", "architecture", "stack", "built with"],
    tag: "ANSWER",
    text: "Quereo is one Node API plus a MongoDB for its own data, with a React front end. Deploy it wherever you deploy things; it connects to your databases like any other client, no agents or sidecars.",
  },
  {
    keys: ["price", "pricing", "cost", "costs", "free", "pay", "subscription", "how much"],
    tag: "ANSWER",
    text: "It's free to start: create an account, connect a database and go. There's no card to enter.",
  },
  {
    keys: ["who built", "who made", "author", "creator", "kadambari", "team", "built this"],
    tag: "ANSWER",
    text: "Quereo was built by Kadambari, who sees a Seq Scan and takes it personally.",
  },
  {
    keys: ["hello", "hi", "hey", "yo", "sup", "hola", "namaste", "bonjour", "hii", "heya", "good morning", "good evening"],
    tag: "HI",
    text: "Hi. Ask me anything about Quereo: how verdicts work, index trials, monitors, safety, or setup.",
  },
];

const FALLBACK = {
  tag: "HMM",
  tone: "warn",
  text: "That one's outside what I know. I can tell you about verdicts, slow queries, index trials, monitors and alerts, schema diff, the AI, safety and setup. Try one of those?",
};

const normalise = (s) => ` ${s.toLowerCase().replace(/[^a-z0-9_\s'-]/g, " ").replace(/\s+/g, " ").trim()} `;

export function answer(question) {
  const q = normalise(question);
  let best = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    let score = 0;
    for (const key of topic.keys) {
      // whole-word or whole-phrase matches; longer phrases count for more
      if (q.includes(` ${key} `)) score += key.split(" ").length * 2;
      else if (key.length > 5 && q.includes(key)) score += 1;
    }
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  const hit = best ?? FALLBACK;
  return { tag: hit.tag, tone: hit.tone ?? "pass", text: hit.text };
}

export const ASK_TONE = { pass: "bg-pass-soft text-pass", warn: "bg-warn-soft text-warn", slow: "bg-slow-soft text-slow" };

export const ASK_STARTERS = ["is it safe on production?", "how do index trials work?", "does the AI see my data?"];
