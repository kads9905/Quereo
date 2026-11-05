import { useState } from "react";
import { Link, useLocation } from "react-router";
import clsx from "clsx";
import { Button, Card, ErrorNote, Loading } from "../ui";
import { post, get } from "../lib/api";
import { formatBytes, formatMs, formatNumber } from "../lib/format";
import { SAMPLES } from "../lib/samples";
import { CodeEditor, NeedsConnection, PageHeader, useLoad } from "./kit";

const TRIAL_TONE = {
  recommended: ["PASS", "bg-pass-soft text-pass"],
  small_gain: ["SMALL GAIN", "bg-warn-soft text-warn"],
  not_used: ["NOT USED", "bg-fill text-ink-2"],
};

function Trial({ trial }) {
  const [label, tone] = TRIAL_TONE[trial.verdict] ?? TRIAL_TONE.not_used;
  const before = trial.before.rowsExamined || 1;
  return (
    <div className="rise mt-4 rounded-xs border border-line bg-subtle p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={clsx("caps rounded-xs px-1.5 py-0.5", tone)}>{label}</span>
        <span className="text-sm">{trial.message}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[["Before", trial.before, "bg-ink"], ["After", trial.after, "bg-accent"]].map(([name, side, bar]) => (
          <div key={name}>
            <div className="flex justify-between text-xs"><span className="text-ink-2">{name} · rows read</span><span className="tabular font-mono">{formatNumber(side.rowsExamined)} · {formatMs(side.timeMs)}</span></div>
            <div className="mt-1.5 h-1.5 bg-fill"><div className={clsx("h-full", bar)} style={{ width: `${Math.max(1, (side.rowsExamined / before) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-3">The index was removed after measuring. Nothing on the database changed.</p>
    </div>
  );
}

function Suggestion({ connection, sql, suggestion }) {
  const [trial, setTrial] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tryIt = async () => {
    setBusy(true);
    setError("");
    try {
      setTrial(await post(`/connections/${connection._id}/advisor/try`, { sql, table: suggestion.table, columns: suggestion.columns }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="p-4">
      <code className="block font-mono text-sm break-all">{suggestion.statement}</code>
      <p className="mt-2 text-sm text-ink-2">{suggestion.reason}</p>
      {suggestion.rowsExamined != null && (
        <p className="tabular mt-1 font-mono text-xs text-ink-3">reads {formatNumber(suggestion.rowsExamined)} rows to return {formatNumber(suggestion.rowsReturned ?? 0)}</p>
      )}
      {suggestion.note && <p className="mt-1 text-xs text-ink-3">{suggestion.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={tryIt} disabled={busy || connection.readOnly}>{busy ? "Measuring…" : "Try this index"}</Button>
        {connection.readOnly && <span className="text-xs text-ink-3">Trials need a connection with read-only off. <Link to="/app/connections" className="underline underline-offset-4">Change it</Link></span>}
      </div>
      {busy && <Loading className="mt-4" label="Building the index, re-running, then removing it…" />}
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      {trial && <Trial trial={trial} />}
    </li>
  );
}

function Unused({ connection }) {
  const { data, error, loading } = useLoad(() => get(`/connections/${connection._id}/advisor/unused-indexes`), [connection._id]);
  return (
    <Card title="Unused indexes" meta={data ? `${data.unused.length} of ${data.totalIndexes} never read · ${formatBytes(data.wastedBytes)}` : undefined} bodyClassName="p-0">
      {loading && !data ? (
        <Loading className="p-4" />
      ) : error ? (
        <div className="p-4"><ErrorNote>{error}</ErrorNote></div>
      ) : data.unused.length ? (
        <ul className="divide-y divide-line">
          {data.unused.map((index) => (
            <li key={`${index.table}.${index.index}`} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-xs">{index.index}</span>
                <span className="shrink-0 font-mono text-xs text-ink-3">{formatBytes(index.sizeBytes)}</span>
              </div>
              <p className="text-xs text-ink-3">on {index.table}</p>
              {index.dropStatement && <code className="mt-2 block font-mono text-[11px] break-all text-ink-2">{index.dropStatement}</code>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-ink-2">Every index has been read at least once.</p>
      )}
      {data?.note && <p className="border-t border-line px-4 py-3 text-xs text-ink-3">{data.note}</p>}
    </Card>
  );
}

function AdvisorBody({ connection }) {
  const location = useLocation();
  const [sql, setSql] = useState(location.state?.sql ?? SAMPLES[connection.type]?.query ?? "");
  const [result, setResult] = useState(null);
  const [checkedSql, setCheckedSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const suggest = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await post(`/connections/${connection._id}/advisor/suggest`, { sql }));
      setCheckedSql(sql);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Query to improve" bodyClassName="p-0">
          <CodeEditor value={sql} onChange={setSql} onRun={suggest} rows={6} />
          <div className="flex items-center gap-3 border-t border-line px-3 py-2.5">
            <Button size="sm" onClick={suggest} disabled={busy || !sql.trim()}>{busy ? "Reading plan…" : "Suggest indexes"}</Button>
            <span className="text-xs text-ink-3">Runs EXPLAIN ANALYZE and looks for filtered full scans.</span>
          </div>
        </Card>
        <ErrorNote>{error}</ErrorNote>
        {result && (
          <Card title="Suggestions" meta={`${result.message}${result.queryTimeMs != null ? ` · query took ${formatMs(result.queryTimeMs)}` : ""}`} bodyClassName="p-0">
            {result.suggestions.length ? (
              <ul className="divide-y divide-line">
                {result.suggestions.map((s) => <Suggestion key={s.statement} connection={connection} sql={checkedSql} suggestion={s} />)}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-2">This query has no filtered full scans, so an index wouldn't make it faster.</p>
            )}
          </Card>
        )}
      </div>
      <Unused connection={connection} />
    </div>
  );
}

export default function Advisor() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Analyze" title="Index Advisor" description="Find the index a query is missing, then prove it helps: Quereo builds it, measures again, and removes it." />
      <NeedsConnection>{(connection) => <AdvisorBody key={connection._id} connection={connection} />}</NeedsConnection>
    </div>
  );
}
