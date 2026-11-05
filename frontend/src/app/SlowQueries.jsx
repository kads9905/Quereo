import { useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { Button, Card, ErrorNote, Loading, Tabs } from "../ui";
import { get } from "../lib/api";
import { formatMs, formatNumber } from "../lib/format";
import { NeedsConnection, PageHeader, useLoad } from "./kit";

const SORTS = [
  ["total", "Total time"],
  ["mean", "Average time"],
  ["calls", "Calls"],
];

function List({ connection }) {
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState("total");
  const { data, error, loading, reload } = useLoad(() => get(`/connections/${connection._id}/slow-queries?sortBy=${sortBy}&limit=50`), [connection._id, sortBy]);
  const items = data?.items ?? [];
  const maxTotal = Math.max(...items.map((q) => q.totalMs || 0), 1);

  return (
    <Card
      title="Queries"
      meta={data ? `${items.length} from the database's own stats` : undefined}
      bodyClassName="p-0"
      action={
        <div className="flex items-center gap-1">
          <Tabs items={SORTS} value={sortBy} onChange={setSortBy} />
          <Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>
        </div>
      }
    >
      {loading && !data ? (
        <Loading className="p-6" label="Reading query stats…" />
      ) : error ? (
        <div className="p-4"><ErrorNote>{error}</ErrorNote></div>
      ) : items.length ? (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[720px] table-fixed text-sm">
            <thead>
              <tr className="text-left">
                {["Query", "Calls", "Average", "Max", "Total"].map((h, i) => <th key={h} className={clsx("caps border-b border-line px-4 py-2.5 font-normal text-ink-3", i > 0 ? "w-24 text-right" : "w-auto")}>{h}</th>)}
                <th className="w-24 border-b border-line" />
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id} className="group rise transition-colors hover:bg-fill/50" style={{ "--i": Math.min(items.indexOf(q), 12) }}>
                  <td className="border-b border-line px-4 py-3">
                    <p className="truncate font-mono text-xs" title={q.query}>{q.query.replace(/\s+/g, " ")}</p>
                    <div className="mt-2 h-1 bg-fill"><div className={clsx("grow-x h-full", q.slow ? "bg-slow" : "bg-accent")} style={{ width: `${Math.max(1, (q.totalMs / maxTotal) * 100)}%` }} /></div>
                  </td>
                  <td className="border-b border-line px-4 py-3 text-right font-mono text-xs text-ink-2">{formatNumber(q.calls)}</td>
                  <td className={clsx("border-b border-line px-4 py-3 text-right font-mono text-xs", q.slow && "text-slow")}>{formatMs(q.meanMs)}</td>
                  <td className="border-b border-line px-4 py-3 text-right font-mono text-xs text-ink-2">{formatMs(q.maxMs)}</td>
                  <td className="border-b border-line px-4 py-3 text-right font-mono text-xs">{formatMs(q.totalMs)}</td>
                  <td className="border-b border-line px-3 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={() => navigate("/app/workspace", { state: { sql: q.query } })}>Open</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-8 text-sm text-ink-2">
          No stats yet. {connection.type === "postgres" ? "Quereo reads pg_stat_statements; make sure the extension is enabled." : connection.type === "mysql" ? "Quereo reads performance_schema; make sure it's turned on." : "Quereo reads the database profiler; turn profiling on to collect slow operations."}
        </p>
      )}
    </Card>
  );
}

export default function SlowQueries() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Analyze" title="Slow queries" description="What your database has been spending its time on, from its own statistics. Open any query to see its plan." />
      <NeedsConnection>{(connection) => <List key={connection._id} connection={connection} />}</NeedsConnection>
    </div>
  );
}
