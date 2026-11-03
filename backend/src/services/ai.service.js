import { chatJson } from "./llm.service.js";
import { findTable } from "./schema.service.js";

// What we send to the AI is only STRUCTURE and FACTS: table/column names and
// types, indexes, the query, and its plan. Row data never leaves the database.

const ENGINE_NAMES = { postgres: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB" };
const MAX_SCHEMA_CHARS = 24_000;

// Compact, readable description of tables, e.g.
//   Table orders (~400,000 rows)
//     id bigint NOT NULL
//     customer_id integer NOT NULL
//     indexes: orders_pkey (id)
const describeTables = (tables) => {
  let text = "";

  for (const [name, table] of tables) {
    // MongoDB collections: fields are inferred from sample documents
    const heading = table.sampled !== undefined
      ? `Collection ${name} (~${table.rowEstimate.toLocaleString("en-US")} documents, fields seen in ${table.sampled} sampled documents)`
      : `Table ${name} (~${table.rowEstimate.toLocaleString("en-US")} rows)`;
    const lines = [heading];
    for (const [column, info] of Object.entries(table.columns)) {
      lines.push(`  ${column} ${info.type}${info.nullable ? "" : " NOT NULL"}`);
    }
    const indexes = Object.entries(table.indexes).map(([indexName, index]) => `${indexName} (${index.columns.join(", ")})`);
    lines.push(`  indexes: ${indexes.length ? indexes.join(", ") : "none"}`);

    const block = `${lines.join("\n")}\n\n`;
    // Very large databases: stop before the prompt gets too big
    if (text.length + block.length > MAX_SCHEMA_CHARS) {
      text += "(more tables not shown)\n";
      break;
    }
    text += block;
  }

  return text.trim();
};

// ---- Explain a query ----

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentences: what the query does and whether it is efficient" },
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, explanation: { type: "string" } },
        required: ["title", "explanation"],
        additionalProperties: false,
      },
    },
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          explanation: { type: "string" },
          sql: { type: "string", description: "SQL for the fix, or an empty string if none" },
        },
        required: ["title", "explanation", "sql"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "problems", "fixes"],
  additionalProperties: false,
};

const EXPLAIN_SYSTEM_PROMPT = `You are a database performance expert explaining a query to a developer.
Use ONLY the facts provided (query, plan steps, findings, tables). Never invent numbers, tables, columns or indexes.
Explain in plain, simple English. Be specific: name the tables and columns involved.
If the query is already efficient, say so and return no problems.
Fixes must be valid for the given database type, using only tables/collections and columns/fields that exist.
For MongoDB, write fixes as mongosh commands, e.g. db.orders.createIndex({ customerId: 1 }).`;

// Short, readable version of the plan steps, instead of the raw plan JSON
const describePlan = (plan) =>
  plan.nodes
    .map((node) => {
      const parts = [node.operation];
      if (node.table) parts.push(`on ${node.table}`);
      if (node.indexName) parts.push(`using index ${node.indexName}`);
      if (node.filter) parts.push(`filter ${node.filter}`);
      if (node.rowsExamined != null) parts.push(`rows read ${node.rowsExamined}`);
      if (node.rowsReturned != null) parts.push(`rows kept ${node.rowsReturned}`);
      return `- ${parts.join(", ")}`;
    })
    .join("\n");

const explainQueryWithAi = async ({ engine, sql, plan, verdict, schema }) => {
  // Only the tables this query touches
  const tableNames = [...new Set(plan.nodes.map((node) => node.table).filter(Boolean))];
  const tables = tableNames
    .map((name) => findTable(schema, name))
    .filter(Boolean)
    .map((table) => [table.name, table]);

  const findings = [...verdict.issues, ...verdict.tips].map((item) => `- ${item.message}`).join("\n") || "- none";

  const facts = `Database: ${ENGINE_NAMES[engine]}

Query:
${sql}

Run time: ${plan.totalTimeMs != null ? `${plan.totalTimeMs.toFixed(2)} ms` : "not measured (estimates only)"}

Plan steps:
${describePlan(plan)}

Automatic findings (verdict ${verdict.verdict}):
${findings}

Tables:
${describeTables(tables) || "(none)"}`;

  return chatJson({
    schemaName: "query_explanation",
    schema: EXPLAIN_SCHEMA,
    messages: [
      { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
      { role: "user", content: facts },
    ],
  });
};

// ---- Natural language to SQL ----

const SQL_SCHEMA = {
  type: "object",
  properties: {
    sql: { type: "string", description: "A single read-only SELECT statement, or an empty string if the question can't be answered" },
    explanation: { type: "string", description: "One or two sentences on how the query answers the question" },
    assumptions: { type: "array", items: { type: "string" } },
    cannotAnswer: { type: "boolean" },
  },
  required: ["sql", "explanation", "assumptions", "cannotAnswer"],
  additionalProperties: false,
};

const MONGO_SYSTEM_PROMPT = `You write queries for a MongoDB database.
Put the query in the "sql" field as ONE MongoDB database command in JSON (Extended JSON for dates: {"$date": "2025-01-01T00:00:00Z"}). Allowed forms:
  {"find": "<collection>", "filter": {...}, "projection": {...}, "sort": {...}, "limit": 100}
  {"aggregate": "<collection>", "pipeline": [ ... ]}
  {"count": "<collection>", "query": {...}}
  {"distinct": "<collection>", "key": "<field>", "query": {...}}
Rules:
- Read-only: never use $out or $merge, and never insert, update or delete.
- Use only the collections and fields listed. If the question needs data that isn't there, set cannotAnswer to true and explain why.
- For dates relative to now, use an aggregate with {"$match": {"$expr": {"$gte": ["$field", {"$dateSubtract": {"startDate": "$$NOW", "unit": "day", "amount": 30}}]}}}.
- Add a limit of 100 unless the question asks for a count, a total or an exact number of results.
- If the question is ambiguous, pick the most likely meaning and list it in assumptions.`;

const sqlSystemPrompt = (engine) => engine === "mongodb" ? MONGO_SYSTEM_PROMPT : `You write SQL for a ${ENGINE_NAMES[engine]} database.
Rules:
- Return exactly ONE read-only SELECT statement (a WITH ... SELECT is fine). Never write INSERT, UPDATE, DELETE or DDL.
- Use only the tables and columns listed. If the question needs data that isn't there, set cannotAnswer to true and explain why.
- Use ${ENGINE_NAMES[engine]} syntax and functions.
- Add LIMIT 100 unless the question asks for a count, a total or an exact number of rows.
- If the question is ambiguous, pick the most likely meaning and list it in assumptions.`;

// Models naturally write a MongoDB command as a JSON object rather than a string,
// so for MongoDB the "sql" field may be either. Strict mode can't express
// "string or any object", so this schema uses best-effort mode.
const MONGO_QUERY_SCHEMA = {
  ...SQL_SCHEMA,
  properties: {
    ...SQL_SCHEMA.properties,
    sql: { anyOf: [{ type: "string" }, { type: "object" }], description: "The MongoDB command, or an empty string if the question can't be answered" },
  },
};

// `history` is the conversation so far, so a retry can include the
// database's error message and let the model fix its own mistake.
const generateSql = async ({ engine, schema, question, history = [] }) => {
  const result = await chatJson({
    schemaName: "generated_query",
    schema: engine === "mongodb" ? MONGO_QUERY_SCHEMA : SQL_SCHEMA,
    strict: engine !== "mongodb",
    messages: [
      { role: "system", content: sqlSystemPrompt(engine) },
      {
        role: "user",
        content: `${engine === "mongodb" ? "Collections" : "Tables"}:\n${describeTables(Object.entries(schema.tables))}\n\nQuestion: ${question}`,
      },
      ...history,
    ],
  });

  if (result.answer.sql && typeof result.answer.sql === "object") {
    result.answer.sql = JSON.stringify(result.answer.sql);
  }
  return result;
};

export { explainQueryWithAi, generateSql, describeTables };
