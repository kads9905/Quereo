import { useState } from "react";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { Button, Dot, Empty } from "../ui";
import { Icons } from "../ui/icons";
import { del, patch, post } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useSession, useCurrentConnection } from "../store/session";
import { PageHeader, engineLabel } from "./kit";

function Row({ connection, active }) {
  const { refresh, select } = useSession();
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);

  const act = async (kind, work) => {
    setBusy(kind);
    try {
      await work();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  const test = () =>
    act("test", async () => {
      try {
        const info = await post(`/connections/${connection._id}/test`);
        setStatus({ ok: true, text: info.serverVersion ?? "Connected" });
      } catch (err) {
        setStatus({ ok: false, text: err.message });
      }
    });

  const toggleReadOnly = () =>
    act("ro", async () => {
      if (connection.readOnly && !window.confirm("Turn read-only off? Queries could then change data on this database. Use this for dev or staging only.")) return;
      await patch(`/connections/${connection._id}`, { readOnly: !connection.readOnly });
      await refresh();
    });

  const remove = () =>
    act("delete", async () => {
      if (!window.confirm(`Delete "${connection.name}"? Its history, saved queries and monitors go with it.`)) return;
      await del(`/connections/${connection._id}`);
      await refresh();
      toast.success("Connection deleted");
    });

  return (
    <li className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-md">{connection.name}</span>
          <span className="caps rounded-xs bg-fill px-1.5 py-0.5 text-ink-2">{engineLabel(connection.type)}</span>
          {connection.readOnly ? <span className="caps rounded-xs bg-pass-soft px-1.5 py-0.5 text-pass">Read-only</span> : <span className="caps rounded-xs bg-warn-soft px-1.5 py-0.5 text-warn">Writable</span>}
          {active && <span className="caps text-accent-ink">Open</span>}
        </div>
        <p className="mt-1 truncate font-mono text-xs text-ink-3">{connection.username}@{connection.host}:{connection.port}/{connection.database}</p>
        {status && <p className={`mt-2 flex items-center gap-2 text-xs ${status.ok ? "text-pass" : "text-slow"}`}><Dot tone={status.ok ? "ok" : "bad"} />{status.text}</p>}
        {connection.createdAt && <p className="mt-1 text-xs text-ink-3">Added {timeAgo(connection.createdAt)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!active && <Button size="sm" variant="secondary" onClick={() => select(connection._id)}>Open</Button>}
        <Button size="sm" variant="secondary" onClick={test} disabled={!!busy}>{busy === "test" ? "Testing…" : "Test"}</Button>
        <Button size="sm" variant="secondary" onClick={toggleReadOnly} disabled={!!busy}>{connection.readOnly ? "Allow writes" : "Make read-only"}</Button>
        <Button size="sm" variant="danger" onClick={remove} disabled={!!busy} aria-label={`Delete ${connection.name}`}><Icons.trash className="size-3.5" /></Button>
      </div>
    </li>
  );
}

export default function Connections() {
  const connections = useSession((s) => s.connections);
  const current = useCurrentConnection();
  const { openAddConnection } = useOutletContext();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Connections"
        description="Databases Quereo can read. Passwords are encrypted at rest and never sent back to the browser."
        actions={<Button size="sm" onClick={openAddConnection}><Icons.plus className="size-3.5" />Add connection</Button>}
      />
      {connections.length ? (
        <ul className="divide-y divide-line rounded-md border border-line">
          {connections.map((c) => <Row key={c._id} connection={c} active={c._id === current?._id} />)}
        </ul>
      ) : (
        <Empty title="No connections yet" action={<Button size="sm" onClick={openAddConnection}>Add a connection</Button>}>
          PostgreSQL, MySQL or MongoDB. The sample databases fill in with one click.
        </Empty>
      )}
    </div>
  );
}
