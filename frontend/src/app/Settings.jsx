import { useState } from "react";
import clsx from "clsx";
import { Button, Card, Dialog, Dot, ErrorNote } from "../ui";
import { Icons } from "../ui/icons";
import { useSession } from "../store/session";
import { Avatar, useAccountDropped, useSignOut } from "./account";
import { PageHeader } from "./kit";
import { ActivityCard } from "./Activity";

function Row({ label, children }) {
  return (
    <div className="grid gap-1 py-3.5 sm:grid-cols-[180px_minmax(0,1fr)]">
      <span className="caps text-ink-3">{label}</span>
      <span className="min-w-0 truncate text-sm">{children}</span>
    </div>
  );
}

// Deleting needs the email typed back; the button arms only when it matches
function DeleteAccountDialog({ open, onClose }) {
  const { user, connections, deleteAccount } = useSession();
  const dropped = useAccountDropped();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const armed = typed.trim().toLowerCase() === user?.email;

  const close = () => {
    if (busy) return;
    setTyped("");
    setError("");
    onClose();
  };

  const onDelete = async (e) => {
    e.preventDefault();
    if (!armed) return;
    setBusy(true);
    setError("");
    try {
      const counts = await deleteAccount(typed);
      onClose();
      dropped(counts);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Danger zone">
      <form onSubmit={onDelete} className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xs bg-slow-soft text-slow"><Icons.trash className="size-4" /></span>
          <div>
            <p className="heading text-[22px] leading-[28px]">Delete your account?</p>
            <p className="mt-1.5 text-sm text-ink-2">This can't be undone. Quereo forgets everything it keeps for you.</p>
          </div>
        </div>
        <ul className="divide-y divide-line rounded-xs border border-line font-mono text-xs">
          {[
            [`${connections.length} connection${connections.length === 1 ? "" : "s"}`, "and their encrypted passwords"],
            ["every monitor", "with its runs and incidents"],
            ["query history", "saved queries and snapshots"],
          ].map(([what, detail], i) => (
            <li key={what} className="rise flex items-center gap-3 px-3 py-2.5" style={{ "--i": i }}>
              <span className="text-slow">DROP</span>
              <span className="text-ink">{what}</span>
              <span className="ml-auto hidden text-ink-3 sm:inline">{detail}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-3">Your databases themselves aren't touched. Quereo only ever read from them.</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-2">Type <span className="font-mono text-ink">{user?.email}</span> to confirm</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={clsx(
              "h-10 w-full rounded-xs border bg-bg px-3 font-mono text-sm text-ink transition-[border-color,box-shadow] duration-200 focus:outline-none",
              armed ? "border-slow shadow-[0_0_0_3px_var(--color-slow-soft)]" : "border-line-2 focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)]"
            )}
          />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>Keep my account</Button>
          <Button type="submit" variant="danger" disabled={!armed || busy}>
            {busy ? <span className="spin size-3.5 rounded-full border border-slow/30 border-t-slow" /> : <Icons.trash className="size-3.5" />}
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Settings() {
  const { user, ai, connections } = useSession();
  const signOut = useSignOut();
  const [deleting, setDeleting] = useState(false);
  const joined = user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "–";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Account" title="Settings" description="Your account and how this Quereo server is set up." />

      <div className="rise flex flex-wrap items-center gap-4 rounded-md border border-line bg-subtle/40 p-5">
        <Avatar user={user} size={56} animate />
        <div className="min-w-0 flex-1">
          <p className="heading truncate text-[24px] leading-[30px]">{user?.fullName}</p>
          <p className="truncate text-sm text-ink-3">{user?.email}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={signOut}><Icons.logout className="size-3.5" />Sign out</Button>
      </div>

      <ActivityCard />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Card title="Account" icon={<Icons.user className="size-3.5" />}>
          <div className="divide-y divide-line">
            <Row label="Name">{user?.fullName}</Row>
            <Row label="Email">{user?.email}</Row>
            <Row label="Joined">{joined}</Row>
            <Row label="Connections">{connections.length}</Row>
          </div>
        </Card>
        <Card title="AI" icon={<Icons.sparkle className="size-3.5" />}>
          <div className="divide-y divide-line">
            <Row label="Status"><span className="flex items-center gap-2"><Dot tone={ai.enabled ? "ok" : "idle"} live={ai.enabled} />{ai.enabled ? "On" : "Off"}</span></Row>
            <Row label="Provider">{ai.enabled ? "Groq" : "–"}</Row>
            <Row label="Model"><span className="font-mono text-xs">{ai.model ?? "–"}</span></Row>
          </div>
          <p className="mt-4 text-xs text-ink-3">
            {ai.enabled
              ? "The model sees table and column names, your query and its plan. Never the rows."
              : "Set GROQ_API_KEY on the server to turn on plain-English queries and explanations."}
          </p>
        </Card>
      </div>

      <section className="rise rounded-md border border-slow/25 bg-slow-soft/20" style={{ "--i": 2 }}>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="caps text-slow">Danger zone</p>
            <p className="mt-2 text-sm">Delete your account</p>
            <p className="mt-1 text-xs text-ink-3">Removes your connections, monitors, history and snapshots for good.</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}><Icons.trash className="size-3.5" />Delete account</Button>
        </div>
      </section>

      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} />
    </div>
  );
}
