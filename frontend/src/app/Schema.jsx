import { useMemo, useState } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, Card, ErrorNote, Input, Loading, Select } from "../ui";
import { Icons } from "../ui/icons";
import { del, get, post } from "../lib/api";
import { compactRows, timeAgo } from "../lib/format";
import { useSession } from "../store/session";
import { NeedsConnection, PageHeader, useLoad, engineLabel } from "./kit";

const SUMMARY = { tablesAdded: "tables added", tablesRemoved: "tables removed", tablesChanged: "tables changed", breaking: "breaking", warnings: "warnings", info: "info" };
const SEVERITY = { breaking: "bg-slow-soft text-slow", warning: "bg-warn-soft text-warn", info: "bg-fill text-ink-2" };

function TableView({ table }) {
  const columns = Object.entries(table.columns ?? {});
  const indexes = Object.entries(table.indexes ?? {});
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-mono text-md">{table.schema ? `${table.schema}.` : ""}{table.name}</h2>
        <span className="text-xs text-ink-3">{compactRows(table.rowEstimate)} rows · {columns.length} columns · {indexes.length} indexes</span>
      </div>
      <div className="overflow-x-auto rounded-xs border border-line">
        <table className="w-full text-xs">
          <thead className="bg-subtle">
            <tr>{["Column", "Type", "Null", "Default"].map((h) => <th key={h} className="caps border-b border-line px-3 py-2 text-left font-normal text-ink-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {columns.map(([name, col]) => (
              <tr key={name}>
                <td className="border-b border-line px-3 py-2 font-mono">{name}</td>
                <td className="border-b border-line px-3 py-2 font-mono text-accent-ink">{col.type}</td>
                <td className="border-b border-line px-3 py-2 text-ink-3">{col.nullable ? "yes" : "no"}</td>
                <td className="max-w-[220px] truncate border-b border-line px-3 py-2 font-mono text-ink-3">{col.default ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="caps text-ink-3">Indexes</p>
        <ul className="mt-2 space-y-1.5">
          {indexes.map(([name, index]) => (
            <li key={name} className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span>{name}</span>
              <span className="text-ink-3">({index.columns.join(", ")})</span>
              {index.primary && <span className="caps rounded-xs bg-accent-soft px-1.5 text-accent-ink">primary</span>}
              {index.unique && !index.primary && <span className="caps rounded-xs bg-fill px-1.5 text-ink-2">unique</span>}
            </li>
          ))}
          {!indexes.length && <li className="text-sm text-ink-2">No indexes.</li>}
        </ul>
      </div>
    </div>
  );
}

function Browser({ schema }) {
  const tables = useMemo(() => Object.entries(schema.tables).sort(([, a], [, b]) => b.rowEstimate - a.rowEstimate), [schema]);
  const [selected, setSelected] = useState(tables[0]?.[0]);
  const [filter, setFilter] = useState("");
  const shown = tables.filter(([key]) => key.toLowerCase().includes(filter.toLowerCase()));
  const table = schema.tables[selected];

  return (
    <Card title="Tables" meta={`${tables.length} · ${engineLabel(schema.engine)}${schema.inferred ? " · inferred from sample documents" : ""}`} bodyClassName="grid p-0 md:grid-cols-[240px_minmax(0,1fr)]">
      <div className="border-b border-line md:border-r md:border-b-0">
        <div className="p-3"><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables" className="h-8" /></div>
        <ul className="max-h-[480px] overflow-y-auto pb-2">
          {shown.map(([key, t]) => (
            <li key={key}>
              <button type="button" onClick={() => setSelected(key)} className={clsx("flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left font-mono text-xs", selected === key ? "bg-fill text-ink" : "text-ink-2 hover:bg-subtle hover:text-ink")}>
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 text-ink-3">{compactRows(t.rowEstimate)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 p-5">{table ? <TableView table={table} /> : <p className="text-sm text-ink-2">No tables.</p>}</div>
    </Card>
  );
}

function Diff({ connection, snapshots }) {
  const connections = useSession((s) => s.connections);
  const [target, setTarget] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = connections.filter((c) => c._id !== connection._id && c.type === connection.type);

  const compare = async () => {
    if (!target) return;
    const [kind, id] = target.split(":");
    setBusy(true);
    setError("");
    try {
      setResult(await post("/schema/diff", { source: { connectionId: connection._id }, target: kind === "c" ? { connectionId: id } : { snapshotId: id } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Compare" meta="this database against another, or a snapshot">
      <div className="flex flex-wrap gap-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1">
          <option value="">Choose what to compare with…</option>
          {others.length > 0 && <optgroup label="Connections">{others.map((c) => <option key={c._id} value={`c:${c._id}`}>{c.name}</option>)}</optgroup>}
          {snapshots.length > 0 && <optgroup label="Snapshots">{snapshots.map((s) => <option key={s._id} value={`s:${s._id}`}>{s.name} · {timeAgo(s.createdAt)}</option>)}</optgroup>}
        </Select>
        <Button onClick={compare} disabled={!target || busy}>{busy ? "Comparing…" : "Compare"}</Button>
      </div>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      {result && (
        <div className="rise mt-2">
          {result.identical ? (
            <p className="rounded-xs bg-pass-soft px-4 py-3 text-sm text-pass">✓ No differences. The schemas match.</p>
          ) : (
            <>
              <p className="caps text-ink-3">
                {Object.entries(result.summary ?? {}).filter(([, n]) => n).map(([k, n]) => `${n} ${SUMMARY[k] ?? k}`).join(" · ")}
              </p>
              <ul className="mt-3 space-y-2">
                {result.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={clsx("caps w-[74px] shrink-0 rounded-xs px-1.5 py-0.5 text-center", SEVERITY[change.severity] ?? SEVERITY.info)}>{change.severity}</span>
                    <span className="font-mono text-xs leading-5">{change.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function Snapshots({ connection, snapshots, reload }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await post("/schema/snapshots", { connectionId: connection._id, name: name || `${connection.name} · ${new Date().toLocaleDateString()}` });
      toast.success("Snapshot saved");
      setName("");
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await del(`/schema/snapshots/${id}`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card title="Snapshots" meta="the schema frozen in time" bodyClassName="p-0">
      <form onSubmit={save} className="flex gap-2 border-b border-line p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Before the March migration" className="h-8" />
        <Button size="sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </form>
      <ul className="divide-y divide-line">
        {snapshots.map((s) => (
          <li key={s._id} className="group flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{s.name}</span>
              <span className="block text-xs text-ink-3">{s.tableCount} tables · {timeAgo(s.createdAt)}</span>
            </span>
            <button type="button" aria-label={`Delete ${s.name}`} onClick={() => remove(s._id)} className="grid size-7 place-items-center rounded-xs text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-fill hover:text-slow focus-visible:opacity-100">
              <Icons.trash className="size-3.5" />
            </button>
          </li>
        ))}
        {!snapshots.length && <li className="px-4 py-4 text-sm text-ink-2">No snapshots of this database yet.</li>}
      </ul>
    </Card>
  );
}

function SchemaBody({ connection }) {
  const schema = useLoad(() => get(`/connections/${connection._id}/schema`), [connection._id]);
  const snaps = useLoad(() => get("/schema/snapshots"), []);
  const mine = (snaps.data ?? []).filter((s) => s.connection === connection._id || s.engine === connection.type);

  return (
    <div className="flex flex-col gap-4">
      {schema.loading && !schema.data ? <Loading label="Reading the schema…" /> : schema.error ? <ErrorNote>{schema.error}</ErrorNote> : <Browser schema={schema.data} />}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Diff connection={connection} snapshots={mine} />
        <Snapshots connection={connection} snapshots={(snaps.data ?? []).filter((s) => s.connection === connection._id)} reload={snaps.reload} />
      </div>
    </div>
  );
}

export default function Schema() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Structure" title="Schema" description="Every table, column and index. Compare against another environment or a saved snapshot to catch breaking changes." />
      <NeedsConnection>{(connection) => <SchemaBody key={connection._id} connection={connection} />}</NeedsConnection>
    </div>
  );
}
