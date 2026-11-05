import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, Empty, ErrorNote, Field, Input, Select, Verdict } from "../ui";
import { formatCell, formatMs, formatNumber, ENGINES } from "../lib/format";
import { SAMPLES } from "../lib/samples";
import { post } from "../lib/api";
import { useSession, useCurrentConnection } from "../store/session";

// ── Load data and keep loading/error state in one place
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      setState({ data: await loader(), error: "", loading: false });
    } catch (error) {
      setState({ data: null, error: error.message, loading: false });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

// ── Page title row
export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-2">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow rise">{eyebrow}</p>}
        <h1 className={clsx("heading rise text-[28px] leading-[34px] sm:text-[34px] sm:leading-[40px]", eyebrow && "mt-3")} style={{ "--i": 1 }}>{title}</h1>
        {description && <p className="rise mt-2 max-w-[68ch] text-sm text-ink-2" style={{ "--i": 2 }}>{description}</p>}
      </div>
      {actions && <div className="rise flex flex-wrap items-center gap-2" style={{ "--i": 3 }}>{actions}</div>}
    </div>
  );
}

// ── Code editor: line numbers that scroll with the text, current line highlighted,
// Ctrl/Cmd+Enter runs
export const CodeEditor = forwardRef(function CodeEditor({ value, onChange, onRun, rows = 9, label = "Query", className }, outerRef) {
  const gutter = useRef(null);
  const inner = useRef(null);
  const [line, setLine] = useState(0);
  const [scroll, setScroll] = useState(0);
  const lines = Math.max(rows, value.split("\n").length);
  const track = (el) => setLine(el.value.slice(0, el.selectionStart).split("\n").length - 1);
  return (
    <div className={clsx("relative flex font-mono text-[13px] leading-6", className)}>
      <div ref={gutter} aria-hidden className="w-11 shrink-0 overflow-hidden border-r border-line py-4 text-right text-ink-3 select-none">
        {Array.from({ length: lines }, (_, i) => <div key={i} className={clsx("pr-3 transition-colors duration-150", i === line && "text-accent-ink")}>{i + 1}</div>)}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-fill/70 transition-transform duration-100 ease-out" style={{ transform: `translateY(${16 + line * 24 - scroll}px)` }} />
        <textarea
          ref={(el) => {
            inner.current = el;
            if (typeof outerRef === "function") outerRef(el);
            else if (outerRef) outerRef.current = el;
          }}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            track(e.target);
          }}
          onKeyUp={(e) => track(e.target)}
          onClick={(e) => track(e.target)}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.target.scrollTop;
            setScroll(e.target.scrollTop);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onRun) {
              e.preventDefault();
              onRun();
            }
          }}
          spellCheck={false}
          rows={rows}
          aria-label={label}
          className="relative block w-full resize-y bg-transparent px-4 py-4 text-ink caret-accent placeholder:text-ink-3 focus:outline-none"
        />
      </div>
    </div>
  );
});

// ── Pages that need an open connection render this when there isn't one
export function NeedsConnection({ children }) {
  const connection = useCurrentConnection();
  if (connection) return children(connection);
  return (
    <Empty
      icon={<svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="4" rx="5" ry="1.8" /><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" /></svg>}
      title="No database connected yet"
      action={<Button as={Link} to="/app/connections" size="sm" arrow>Add a connection</Button>}
    >
      Quereo needs a database to look at. Add one in Connections; the sample databases take one click.
    </Empty>
  );
}

// ── Query result rows
export function ResultTable({ columns, rows, maxHeight = "420px" }) {
  if (!columns?.length) return <p className="text-sm text-ink-2">The statement ran and returned no rows.</p>;
  return (
    <div className="overflow-auto rounded-xs border border-line" style={{ maxHeight }}>
      <table className="tabular w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-subtle">
          <tr>{columns.map((c, i) => <th key={i} className="caps border-b border-line px-3 py-2 text-left font-normal whitespace-nowrap text-ink-3">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="rise transition-colors hover:bg-fill/60" style={{ "--i": Math.min(r, 12) }}>
              {row.map((value, c) => {
                const shown = formatCell(value);
                return (
                  <td key={c} title={shown ?? "NULL"} className="max-w-[320px] truncate border-b border-line px-3 py-2 font-mono text-ink">
                    {shown === null ? <span className="text-ink-3">NULL</span> : shown}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Verdict with its checks, issues and tips
export function VerdictPanel({ verdict, durationMs }) {
  if (!verdict) return null;
  return (
    <div className="swap rounded-md border border-line bg-subtle/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Verdict value={verdict.verdict} />
        <span className="text-sm">{verdict.summary}</span>
        {durationMs != null && <span className="tabular ml-auto font-mono text-xs text-ink-2">{formatMs(durationMs)}</span>}
      </div>
      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {verdict.checks.map((check) => (
          <li key={check.name} className="flex items-center gap-2">
            <span className={clsx("font-mono text-xs", check.passed ? "text-pass" : "text-warn")}>{check.passed ? "✓" : "✕"}</span>
            <span className={check.passed ? "text-ink-2" : "text-ink"}>{check.name}</span>
          </li>
        ))}
      </ul>
      {verdict.issues.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-4">
          {verdict.issues.map((issue, i) => (
            <li key={i} className="text-sm">
              <p>{issue.message}</p>
              <p className="mt-0.5 text-ink-2">{issue.suggestion}</p>
            </li>
          ))}
        </ul>
      )}
      {verdict.tips.length > 0 && (
        <ul className="mt-3 space-y-1">
          {verdict.tips.map((tip, i) => <li key={i} className="text-xs text-ink-3">Tip · {tip.message}. {tip.suggestion}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Add a connection (with one-click sample databases)
export function AddConnectionDialog({ open, onClose }) {
  const { types, refresh, select } = useSession();
  const [type, setType] = useState("postgres");
  const [form, setForm] = useState({ name: "", host: "", port: "5432", database: "", username: "", password: "", readOnly: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  const changeType = (event) => {
    const next = event.target.value;
    setType(next);
    setForm((f) => ({ ...f, port: String(types.find((t) => t.type === next)?.defaultPort ?? f.port) }));
  };

  const fillSample = () => {
    const { query: _query, ...sample } = SAMPLES[type];
    setForm((f) => ({ ...f, ...sample, port: String(sample.port), name: `${type === "postgres" ? "pg" : type === "mysql" ? "mysql" : "mongo"}-shop` }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { connection, serverVersion } = await post("/connections", { ...form, type, port: Number(form.port) });
      await refresh();
      select(connection._id);
      toast.success(`Connected to ${serverVersion}`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add a connection">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Database">
            <Select value={type} onChange={changeType}>
              {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
          </Field>
          <Button type="button" variant="secondary" onClick={fillSample}>Use sample</Button>
        </div>
        <Field label="Name"><Input value={form.name} onChange={set("name")} placeholder="shop-prod" required /></Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Host"><Input value={form.host} onChange={set("host")} placeholder="db.example.com" required /></Field>
          <Field label="Port"><Input value={form.port} onChange={set("port")} inputMode="numeric" required /></Field>
        </div>
        <Field label="Database name"><Input value={form.database} onChange={set("database")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="User"><Input value={form.username} onChange={set("username")} autoComplete="off" required /></Field>
          <Field label="Password"><Input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" /></Field>
        </div>
        <Checkbox label="Read-only (recommended)" checked={form.readOnly} onChange={set("readOnly")} />
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Testing…" : "Test and save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export const engineLabel = (type) => ENGINES[type] ?? type;
export { formatNumber };
