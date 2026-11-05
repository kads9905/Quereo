import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { Button, Card, ErrorNote, Input, Kbd, Loading, Tabs } from "../ui";
import { Icons } from "../ui/icons";
import { del, get, post } from "../lib/api";
import { formatMs, formatNumber } from "../lib/format";
import { SAMPLES } from "../lib/samples";
import { useSession } from "../store/session";
import { CodeEditor, NeedsConnection, PageHeader, ResultTable, VerdictPanel, useLoad } from "./kit";

function PlanTable({ plan }) {
  if (!plan?.nodes?.length) return <p className="text-sm text-ink-2">No plan details for this statement.</p>;
  return (
    <div className="overflow-auto rounded-xs border border-line">
      <table className="tabular w-full text-xs">
        <thead className="bg-subtle">
          <tr>{["Step", "Table", "Index", "Rows read", "Rows out"].map((h) => <th key={h} className="caps border-b border-line px-3 py-2 text-left font-normal text-ink-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {plan.nodes.map((node, i) => (
            <tr key={i}>
              <td className="border-b border-line px-3 py-2 font-mono">{node.operation}</td>
              <td className="border-b border-line px-3 py-2 font-mono text-ink-2">{node.table ?? "–"}</td>
              <td className="border-b border-line px-3 py-2 font-mono text-ink-2">{node.indexName ?? "–"}</td>
              <td className="border-b border-line px-3 py-2 font-mono">{node.rowsExamined == null ? "–" : formatNumber(node.rowsExamined)}</td>
              <td className="border-b border-line px-3 py-2 font-mono">{node.rowsReturned == null ? "–" : formatNumber(node.rowsReturned)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiAnswer({ explanation }) {
  const block = (title, items) =>
    items?.length > 0 && (
      <div>
        <p className="caps text-ink-3">{title}</p>
        <ul className="mt-2 space-y-1.5 text-sm">{items.map((item, i) => <li key={i} className="flex gap-2"><span className="text-ink-3">–</span>{typeof item === "string" ? item : item.message ?? JSON.stringify(item)}</li>)}</ul>
      </div>
    );
  return (
    <div className="space-y-5">
      <p className="text-md">{explanation.summary}</p>
      {block("Problems", explanation.problems)}
      {block("Fixes", explanation.fixes)}
    </div>
  );
}

function Editor({ connection }) {
  const location = useLocation();
  const ai = useSession((s) => s.ai);
  const sample = SAMPLES[connection.type]?.query ?? "";
  const [sql, setSql] = useState(location.state?.sql ?? sample);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("result");
  const [result, setResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiSql, setAiSql] = useState(null);
  const editorRef = useRef(null);
  const saved = useLoad(() => get(`/saved-queries?connectionId=${connection._id}`), [connection._id]);

  useEffect(() => {
    if (location.state?.sql) setSql(location.state.sql);
  }, [location.state]);

  const act = async (kind, work) => {
    if (!sql.trim() && kind !== "ask") return;
    setBusy(kind);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const run = () =>
    act("run", async () => {
      setResult(await post(`/connections/${connection._id}/query`, { sql }));
      setTab("result");
    });

  const explain = () =>
    act("explain", async () => {
      setPlan(await post(`/connections/${connection._id}/explain`, { sql, analyze: true }));
      setTab("plan");
    });

  const explainWithAi = () =>
    act("ai", async () => {
      setAiAnswer(await post(`/connections/${connection._id}/ai/explain`, { sql }));
      setTab("ai");
    });

  const ask = (event) => {
    event.preventDefault();
    if (!question.trim()) return;
    act("ask", async () => {
      const answer = await post(`/connections/${connection._id}/ai/sql`, { question });
      setAiSql(answer);
      if (answer.sql && !answer.cannotAnswer) setSql(answer.sql);
    });
  };

  const save = async () => {
    const name = window.prompt("Name this query", sql.split("\n")[0].slice(0, 60));
    if (!name) return;
    try {
      await post("/saved-queries", { connectionId: connection._id, name, sql });
      toast.success("Query saved");
      saved.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await del(`/saved-queries/${id}`);
      saved.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tabs = [
    ["result", "Result", result],
    ["plan", "Plan", plan],
    ["ai", "AI explanation", aiAnswer],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-4">
        {ai.enabled && (
          <form onSubmit={ask} className="flex gap-2">
            <div className="relative flex-1">
              <Icons.sparkle className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-accent" />
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask in English, e.g. top 5 customers by order value" className="pl-9" />
            </div>
            <Button type="submit" variant="secondary" disabled={busy === "ask"}>{busy === "ask" ? "Writing…" : "Write query"}</Button>
          </form>
        )}
        {aiSql && (
          <div className="rounded-xs border border-line bg-subtle px-4 py-3 text-sm">
            {aiSql.cannotAnswer ? (
              <p className="text-warn">{aiSql.explanation || "That question can't be answered from this schema."}</p>
            ) : (
              <>
                <p className="flex items-center gap-2">
                  <span className={aiSql.valid ? "text-pass" : "text-warn"}>{aiSql.valid ? "✓ Checked with EXPLAIN" : "✕ Didn't pass EXPLAIN"}</span>
                  <span className="text-ink-3">· {aiSql.attempts} attempt{aiSql.attempts > 1 ? "s" : ""} · not run</span>
                </p>
                {aiSql.explanation && <p className="mt-1 text-ink-2">{aiSql.explanation}</p>}
                {aiSql.assumptions?.length > 0 && <p className="mt-1 text-xs text-ink-3">Assumes: {aiSql.assumptions.join("; ")}</p>}
                {aiSql.error && <p className="mt-1 text-xs text-slow">{aiSql.error}</p>}
              </>
            )}
          </div>
        )}

        <Card
          title="Query"
          meta={connection.type === "mongodb" ? "MongoDB command as JSON" : "one statement"}
          bodyClassName="p-0"
          action={<span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:flex"><Kbd>Ctrl</Kbd><Kbd>↵</Kbd><span className="ml-1">to run</span></span>}
        >
          <CodeEditor ref={editorRef} value={sql} onChange={setSql} onRun={run} rows={9} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
            <Button size="sm" onClick={run} disabled={!!busy}><Icons.play className="size-3" />{busy === "run" ? "Running…" : "Run"}</Button>
            <Button size="sm" variant="secondary" onClick={explain} disabled={!!busy}>{busy === "explain" ? "Reading plan…" : "Explain"}</Button>
            {ai.enabled && <Button size="sm" variant="secondary" onClick={explainWithAi} disabled={!!busy}>{busy === "ai" ? "Thinking…" : "Explain with AI"}</Button>}
            <Button size="sm" variant="ghost" onClick={save} className="ml-auto">Save</Button>
          </div>
        </Card>

        <ErrorNote>{error}</ErrorNote>

        {(result || plan || aiAnswer) && (
          <div className="flex flex-col gap-4">
            <Tabs size="md" items={tabs.filter(([, , has]) => has).map(([key, label]) => [key, label])} value={tab} onChange={setTab} className="self-start" />

            {tab === "result" && result && (
              <div key="result" className="swap flex flex-col gap-4">
                <VerdictPanel verdict={result.verdict} durationMs={result.durationMs} />
                <p className="caps text-ink-3">
                  {result.command} · {formatNumber(result.rowCount)} row{result.rowCount === 1 ? "" : "s"} · {formatMs(result.durationMs)}
                  {result.truncated && " · showing the first rows"}
                </p>
                <ResultTable columns={result.columns} rows={result.rows} />
              </div>
            )}
            {tab === "plan" && plan && (
              <div key="plan" className="swap flex flex-col gap-4">
                <VerdictPanel verdict={plan.verdict} durationMs={plan.plan.totalTimeMs} />
                <PlanTable plan={plan.plan} />
                <details className="text-xs">
                  <summary className="caps cursor-pointer text-ink-3 hover:text-ink">Raw plan</summary>
                  <pre className="mt-3 max-h-[360px] overflow-auto rounded-xs border border-line bg-subtle p-3 font-mono text-ink-2">{typeof plan.plan.raw === "string" ? plan.plan.raw : JSON.stringify(plan.plan.raw, null, 2)}</pre>
                </details>
              </div>
            )}
            {tab === "ai" && aiAnswer && <Card><AiAnswer explanation={aiAnswer.explanation} /></Card>}
          </div>
        )}
      </div>

      <Card title="Saved" bodyClassName="p-0" className="self-start">
        {saved.loading && !saved.data ? (
          <Loading className="p-4" />
        ) : saved.data?.length ? (
          <ul className="divide-y divide-line">
            {saved.data.map((q) => (
              <li key={q._id} className="group flex items-center">
                <button type="button" onClick={() => setSql(q.sql)} className="min-w-0 flex-1 px-4 py-2.5 text-left hover:bg-subtle">
                  <span className="block truncate text-sm">{q.name}</span>
                  <span className="block truncate font-mono text-xs text-ink-3">{q.sql.replace(/\s+/g, " ")}</span>
                </button>
                <button type="button" aria-label={`Delete ${q.name}`} onClick={() => remove(q._id)} className="mr-2 grid size-7 place-items-center rounded-xs text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-fill hover:text-slow focus-visible:opacity-100">
                  <Icons.trash className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-ink-2">Queries you save show up here.</p>
        )}
      </Card>
    </div>
  );
}

export default function Workspace() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Analyze" title="Query workspace" description="Run a query and get its result with a verdict: what the plan did, and what to change." />
      <NeedsConnection>{(connection) => <Editor key={connection._id} connection={connection} />}</NeedsConnection>
    </div>
  );
}
