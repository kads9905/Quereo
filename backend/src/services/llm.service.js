import { ApiError } from "../utils/ApiError.js";

// Groq's API is OpenAI-compatible, so plain fetch is enough (no SDK needed).
// GROQ_BASE_URL can point somewhere else, e.g. a fake server in tests.
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 45_000;

const isAiConfigured = () => Boolean(process.env.GROQ_API_KEY);

// Strict structured outputs = the model is forced to return JSON matching the
// schema exactly (constrained decoding). Only some models support it; others
// get plain JSON mode, and the schema is described in the prompt instead.
const supportsStrictSchema = (model) => /gpt-oss/.test(model);

// Groq checks the answer against the schema; when the model slips, the request
// fails with this code. The model's output varies run to run, so one retry usually works.
const SCHEMA_MISMATCH = "json_validate_failed";

// Sends a chat to Groq and returns the parsed JSON answer.
//   messages: [{ role: "system" | "user" | "assistant", content }]
//   schema:   JSON Schema the answer must follow
//   strict:   false for schemas strict mode can't express (e.g. "string or object")
const chatJson = async ({ messages, schema, schemaName, maxTokens = 2_000, strict: allowStrict = true }, attempt = 1) => {
  if (!isAiConfigured()) {
    throw new ApiError(503, "AI features are not set up. Add GROQ_API_KEY to the server's .env file.");
  }

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const strict = allowStrict && supportsStrictSchema(model);

  const body = {
    model,
    // Models without schema support get the schema as an instruction instead
    messages: supportsStrictSchema(model)
      ? messages
      : [...messages, { role: "system", content: `Reply with JSON only, matching this JSON Schema:\n${JSON.stringify(schema)}` }],
    temperature: 0.1,
    max_completion_tokens: maxTokens,
    response_format: supportsStrictSchema(model)
      ? { type: "json_schema", json_schema: { name: schemaName, strict, schema } }
      : { type: "json_object" },
  };
  // GPT-OSS models think before answering; "low" keeps responses fast
  if (supportsStrictSchema(model)) body.reasoning_effort = "low";

  let response;
  try {
    response = await fetch(`${process.env.GROQ_BASE_URL || DEFAULT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError(502, error.name === "TimeoutError" ? "The AI took too long to answer" : `Could not reach the AI service: ${error.message}`);
  }

  if (response.status === 401) throw new ApiError(502, "Groq rejected the API key. Check GROQ_API_KEY.");
  if (response.status === 429) throw new ApiError(429, "AI rate limit reached. Try again in a minute.");
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (detail.includes(SCHEMA_MISMATCH) && attempt === 1) {
      return chatJson({ messages, schema, schemaName, maxTokens, strict: allowStrict }, 2);
    }
    throw new ApiError(502, `AI request failed (HTTP ${response.status})`, [{ detail: detail.slice(0, 500) }]);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    return { answer: JSON.parse(content), model: data.model || model, usage: data.usage || null };
  } catch {
    throw new ApiError(502, "The AI returned an answer that wasn't valid JSON. Try again.");
  }
};

export { chatJson, isAiConfigured };
