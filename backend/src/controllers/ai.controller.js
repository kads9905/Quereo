import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank } from "../utils/validate.js";
import { getAdapter } from "../adapters/index.js";
import { getOwnedConnection, toAdapterConfig, explainOnConnection } from "../services/connection.service.js";
import { buildVerdict } from "../services/verdict.service.js";
import { explainQueryWithAi, generateSql } from "../services/ai.service.js";
import { isAiConfigured } from "../services/llm.service.js";

const MAX_QUESTION_LENGTH = 1_000;
// One retry: if the database rejects the generated SQL, the error goes back
// to the model so it can fix its own mistake
const MAX_SQL_ATTEMPTS = 2;

const getAiStatus = asyncHandler(async (req, res) => {
  return res.status(200).json(
    new ApiResponse(200, {
      enabled: isAiConfigured(),
      model: isAiConfigured() ? process.env.GROQ_MODEL || "openai/gpt-oss-120b" : null,
    }, "AI status")
  );
});

// POST /api/connections/:id/ai/explain { sql }
const explainWithAi = asyncHandler(async (req, res) => {
  const sql = req.body?.sql;
  if (isBlank(sql)) throw new ApiError(400, "sql is required");

  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const adapter = getAdapter(connection.type);

  // Gather the facts first: real plan + rule-based findings + table structure
  const [plan, schema] = await Promise.all([
    explainOnConnection(connection, sql.trim(), { analyze: true }),
    adapter.getSchema(connection, toAdapterConfig(connection)),
  ]);
  if (!plan) throw new ApiError(400, "This statement can't be explained");

  const verdict = buildVerdict({
    sql,
    durationMs: plan.analyzed ? plan.totalTimeMs : null,
    plan,
    engine: connection.type,
  });

  const { answer, model } = await explainQueryWithAi({ engine: connection.type, sql: sql.trim(), plan, verdict, schema });

  return res.status(200).json(new ApiResponse(200, { explanation: answer, verdict, model }, "Query explained"));
});

// Strips a trailing semicolon and comments-only noise from generated SQL
const cleanSql = (sql) => sql.trim().replace(/;\s*$/, "").trim();

// POST /api/connections/:id/ai/sql { question }
// Writes SQL for a question, checks it against the real database with EXPLAIN
// (which doesn't run it), and returns it. It is NEVER executed here:
// the user reviews it and runs it from the workspace.
const questionToSql = asyncHandler(async (req, res) => {
  const question = req.body?.question;
  if (isBlank(question)) throw new ApiError(400, "question is required");
  if (question.length > MAX_QUESTION_LENGTH) throw new ApiError(400, `question must be under ${MAX_QUESTION_LENGTH} characters`);

  const connection = await getOwnedConnection(req.user._id, req.params.id, { withSecret: true });
  const schema = await getAdapter(connection.type).getSchema(connection, toAdapterConfig(connection));
  if (!Object.keys(schema.tables).length) throw new ApiError(400, "This database has no tables to query");

  const history = [];
  let answer;
  let model;
  let validationError = null;

  for (let attempt = 1; attempt <= MAX_SQL_ATTEMPTS; attempt++) {
    ({ answer, model } = await generateSql({ engine: connection.type, schema, question: question.trim(), history }));

    if (answer.cannotAnswer || isBlank(answer.sql)) {
      return res.status(200).json(
        new ApiResponse(200, {
          sql: null,
          cannotAnswer: true,
          explanation: answer.explanation,
          assumptions: answer.assumptions,
          model,
        }, "The AI couldn't answer this from the available tables")
      );
    }

    answer.sql = cleanSql(answer.sql);
    validationError = null;

    // The exact reason goes back to the model, so its retry can fix the real problem
    const readProblem = getAdapter(connection.type).readQueryProblem(answer.sql);
    if (readProblem) {
      validationError = readProblem;
    } else {
      try {
        // Checks the SQL is valid for this database and gets its plan, without running it
        const plan = await explainOnConnection(connection, answer.sql, { analyze: false });
        const verdict = buildVerdict({ sql: answer.sql, durationMs: null, plan, engine: connection.type });

        return res.status(200).json(
          new ApiResponse(200, {
            sql: answer.sql,
            cannotAnswer: false,
            explanation: answer.explanation,
            assumptions: answer.assumptions,
            valid: true,
            attempts: attempt,
            // Warns before running if the generated SQL will be slow (e.g. a full scan)
            verdict,
            model,
          }, "SQL generated")
        );
      } catch (error) {
        validationError = error.message;
      }
    }

    history.push(
      { role: "assistant", content: JSON.stringify(answer) },
      { role: "user", content: `The database rejected that SQL: ${validationError}\nFix it and return the corrected query.` }
    );
  }

  // Both attempts failed: return the last SQL anyway, clearly marked invalid
  return res.status(200).json(
    new ApiResponse(200, {
      sql: answer.sql,
      cannotAnswer: false,
      explanation: answer.explanation,
      assumptions: answer.assumptions,
      valid: false,
      error: validationError,
      attempts: MAX_SQL_ATTEMPTS,
      model,
    }, "The generated SQL didn't pass validation")
  );
});

export { getAiStatus, explainWithAi, questionToSql };
