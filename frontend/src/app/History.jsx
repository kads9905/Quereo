import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button, Card, ErrorNote, Loading, Verdict } from "../ui";
import { del, get } from "../lib/api";
import { formatMs, formatNumber, timeAgo } from "../lib/format";
import { NeedsConnection, PageHeader } from "./kit";

const PAGE = 30;

function HistoryList({ connection }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (before) => {
    setLoading(true);
    setError("");
    try {
      const page = await get(`/history?connectionId=${connection._id}&limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ""}`);
      setItems((prev) => (before ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(null);
  }, [connection._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = async () => {
    if (!window.confirm("Clear the run history for every connection?")) return;
    try {
      await del("/history");
      setItems([]);
      setCursor(null);
      toast.success("History cleared");
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card title="Runs" meta={items.length ? `${items.length}${cursor ? "+" : ""} on ${connection.name}` : undefined} bodyClassName="p-0" action={items.length > 0 && <Button size="sm" variant="ghost" onClick={clear}>Clear</Button>}>
      <ErrorNote>{error}</ErrorNote>
      <ul className="divide-y divide-line">
        {items.map((run) => (
          <li key={run._id}>
            <button type="button" onClick={() => navigate("/app/workspace", { state: { sql: run.sql } })} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-subtle">
              <span className="w-14 shrink-0">{run.status === "error" ? <span className="caps rounded-xs bg-slow-soft px-1.5 py-0.5 text-slow">Error</span> : <Verdict value={run.verdict ?? "PASS"} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs" title={run.sql}>{run.sql.replace(/\s+/g, " ")}</span>
                {run.error && <span className="block truncate text-xs text-slow">{run.error}</span>}
              </span>
              <span className="hidden shrink-0 font-mono text-xs text-ink-3 sm:block">{run.rowCount == null ? "" : `${formatNumber(run.rowCount)} rows`}</span>
              <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-2">{formatMs(run.durationMs)}</span>
              <span className="hidden w-24 shrink-0 text-right text-xs text-ink-3 sm:block">{timeAgo(run.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {loading && <Loading className="p-4" />}
      {!loading && !items.length && !error && <p className="px-4 py-8 text-sm text-ink-2">Nothing run on this connection yet.</p>}
      {cursor && !loading && (
        <div className="border-t border-line p-3 text-center">
          <Button size="sm" variant="secondary" onClick={() => load(cursor)}>Load more</Button>
        </div>
      )}
    </Card>
  );
}

export default function History() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Watch" title="History" description="Every query you've run, with its verdict and timing. Click one to open it again." />
      <NeedsConnection>{(connection) => <HistoryList key={connection._id} connection={connection} />}</NeedsConnection>
    </div>
  );
}
