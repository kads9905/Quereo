import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router";
import clsx from "clsx";
import { Button, Card, Dot, Empty, ErrorNote, Skeleton, Tabs, Verdict } from "../ui";
import { Icons } from "../ui/icons";
import { CountUp, MicroBars } from "../ui/motion";
import { Spotlight } from "../ui/fx";
import { get } from "../lib/api";
import { compactRows, formatMs, formatNumber, timeAgo } from "../lib/format";
import { useSession, useCurrentConnection } from "../store/session";
import { useLoad, engineLabel } from "./kit";

const REFRESH_MS = 30_000;
const RANGES = [["24", "24 runs"], ["48", "48 runs"], ["96", "96 runs"]];

// Table names a query touches: SQL FROM/JOIN, or a MongoDB command's collection
const tablesIn = (text) => {
  const sql = [...text.matchAll(/\b(?:FROM|JOIN)\s+["`]?([a-zA-Z_][\w]*)/gi)].map((m) => m[1].toLowerCase());
  const mongo = [...text.matchAll(/"(?:find|aggregate|count|distinct)"\s*:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  return [...sql, ...mongo];
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const oneLine = (sql) => sql.replace(/\s+/g, " ").trim();

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const runTone = (run) => (run.status === "error" ? "error" : run.verdict === "SLOW" ? "slow" : run.verdict === "WARN" ? "warn" : "pass");

// Round a dragged threshold to something a person would type
const niceMs = (ms) => (ms < 2 ? Math.max(0.5, Math.round(ms * 2) / 2) : ms < 20 ? Math.round(ms) : ms < 200 ? Math.round(ms / 5) * 5 : Math.round(ms / 25) * 25);

// ── The run tape: every recent run as a bar (log scale). Scrub across it to
// read any run; drag the slow line to decide what "slow" means for you.
function RunTape({ runs, slots, threshold, onThreshold, onOpen }) {
  const [selected, setSelected] = useState(runs.length - 1);
  const [dragging, setDragging] = useState(false);
  const tape = useRef(null);
  const max = Math.max(...runs.map((r) => r.durationMs || 0), threshold * 1.6, 5);
  const top = Math.log10(max + 1);
  const scale = (ms) => Math.log10((ms || 0) + 1) / top;
  const offset = slots - runs.length; // runs sit at the right, newest last

  useEffect(() => setSelected(runs.length - 1), [runs.length]);

  const pickAt = (clientX) => {
    const box = tape.current.getBoundingClientRect();
    const slot = Math.floor(((clientX - box.left) / box.width) * slots);
    setSelected(Math.max(0, Math.min(runs.length - 1, slot - offset)));
  };
  const dragLine = (clientY) => {
    const box = tape.current.getBoundingClientRect();
    const f = Math.max(0.02, Math.min(0.98, 1 - (clientY - box.top) / box.height));
    onThreshold(niceMs(Math.pow(10, f * top) - 1));
  };

  const run = runs[selected];
  const over = runs.filter((r) => (r.durationMs || 0) > threshold).length;
  const passed = runs.filter((r) => runTone(r) === "pass").length;
  const tones = { pass: 0, warn: 0, slow: 0, error: 0 };
  runs.forEach((r) => tones[runTone(r)]++);

  if (!runs.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex h-10 items-end gap-[3px]" aria-hidden>{[3, 6, 4, 9, 5, 7, 2].map((h, i) => <span key={i} className="grow-y w-1.5 rounded-[1px] bg-line-2" style={{ height: `${h * 10}%`, "--i": i }} />)}</span>
        <p className="text-sm">No runs yet.</p>
        <p className="max-w-[40ch] text-xs text-ink-3">Every query you run in the workspace lands on this tape with its verdict and timing.</p>
        <Button as={Link} to="/app/workspace" size="sm" arrow>Run a query</Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
      {/* summary */}
      <div className="flex flex-col justify-between gap-5 border-b border-line p-5 xl:border-r xl:border-b-0">
        <div>
          <p className="caps text-ink-3">Passed every check</p>
          <p className="heading mt-3 text-[64px] leading-none">
            <CountUp value={(passed / runs.length) * 100} format={(n) => Math.round(n)} /><span className="text-ink-3">%</span>
          </p>
          <p className="mt-2 text-xs text-ink-3">of the last {runs.length} runs</p>
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs xl:grid-cols-1">
          {[["pass", "Passed", "bg-ink/70"], ["warn", "Warnings", "bg-warn"], ["slow", "Slow", "bg-slow"], ["error", "Errors", "bg-slow/40"]].map(([k, label, bg]) => (
            <li key={k} className="flex items-center gap-2 text-ink-3">
              <span className={clsx("size-2", bg)} />{label}
              <span className="tabular ml-auto font-mono text-ink-2">{tones[k]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* the tape */}
      <div className="relative min-w-0 border-b border-line px-5 pt-9 pb-4 xl:border-b-0">
        <div className="absolute top-3 right-5 left-5 flex items-center justify-between font-mono text-[10px] text-ink-3">
          <span>{timeAgo(runs[0].createdAt)}</span>
          <span className="hidden sm:inline">scrub to read · drag the line to set “slow”</span>
          <span>now</span>
        </div>
        <div
          ref={tape}
          tabIndex={0}
          role="slider"
          aria-label="Recent runs"
          aria-valuemin={1}
          aria-valuemax={runs.length}
          aria-valuenow={selected + 1}
          aria-valuetext={run ? `${formatMs(run.durationMs)}, ${run.verdict ?? run.status}` : undefined}
          onPointerMove={(e) => (dragging ? dragLine(e.clientY) : pickAt(e.clientX))}
          onPointerDown={(e) => !dragging && pickAt(e.clientX)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSelected((s) => Math.max(0, s - 1));
            else if (e.key === "ArrowRight") setSelected((s) => Math.min(runs.length - 1, s + 1));
            else if (e.key === "ArrowUp") onThreshold(niceMs(threshold * 1.25));
            else if (e.key === "ArrowDown") onThreshold(niceMs(threshold / 1.25));
            else if (e.key === "Enter" && run) onOpen(run);
            else return;
            e.preventDefault();
          }}
          className="relative h-[188px] cursor-crosshair touch-none rounded-xs outline-none focus-visible:shadow-[0_0_0_2px_var(--color-accent-soft)]"
        >
          {/* faint grid */}
          {[0.25, 0.5, 0.75].map((f) => <span key={f} className="pointer-events-none absolute inset-x-0 border-t border-line/60" style={{ bottom: `${f * 100}%` }} aria-hidden />)}

          <div className="absolute inset-0 flex items-end gap-[3px]">
            {Array.from({ length: slots }, (_, slot) => {
              const i = slot - offset;
              const r = runs[i];
              if (!r) return <span key={`e${slot}`} className="h-[3px] flex-1 rounded-[1px] bg-fill" />;
              const tone = runTone(r);
              const isOver = (r.durationMs || 0) > threshold;
              const active = i === selected;
              return (
                <span key={r._id} className="relative flex h-full flex-1 items-end justify-center">
                  <span
                    className={clsx(
                      "grow-y w-full max-w-6 rounded-t-[2px] transition-[background-color,opacity,box-shadow] duration-300",
                      active ? "bg-accent shadow-[0_0_18px_rgb(122_103_255/0.55)]" : tone === "error" ? "bg-slow/40" : isOver ? "bg-slow" : tone === "warn" ? "bg-warn" : "bg-ink/55",
                      !active && "opacity-90"
                    )}
                    style={{ height: `${Math.max(2.5, scale(r.durationMs) * 100)}%`, "--i": slot - offset }}
                  />
                  {active && <span className="swap pointer-events-none absolute -bottom-3 size-1 rounded-full bg-accent" />}
                </span>
              );
            })}
          </div>

          {/* the slow line */}
          <div
            className={clsx("absolute inset-x-0 z-10 border-t border-dashed transition-colors", dragging ? "border-slow" : "border-slow/50")}
            style={{ bottom: `${scale(threshold) * 100}%` }}
          >
            <button
              type="button"
              aria-label={`Slow line at ${formatMs(threshold)}. Drag to change.`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
              }}
              onPointerMove={(e) => dragging && dragLine(e.clientY)}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              className={clsx(
                "absolute right-0 -translate-y-1/2 cursor-ns-resize touch-none rounded-xs border px-1.5 py-0.5 font-mono text-[10px] transition-[background-color,transform] duration-200",
                dragging ? "scale-105 border-slow bg-slow text-white" : "border-slow/40 bg-bg text-slow hover:bg-slow-soft"
              )}
            >
              <span className="mr-1 opacity-60">⇕</span>{formatMs(threshold)}
            </button>
          </div>
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-3">
          <span className={clsx("tabular font-mono", over ? "text-slow" : "text-pass")}>{over}</span>
          {over === 1 ? "run is" : "runs are"} over your slow line
          <span className="text-line-2">·</span>
          <span className="hidden sm:inline">median {formatMs(median(runs.map((r) => r.durationMs || 0)))}</span>
        </p>
      </div>

      {/* readout for the run under the cursor */}
      <div className="flex min-w-0 flex-col gap-4 p-5 xl:border-l xl:border-line">
        {run && (
          <div key={run._id} className="swap flex h-full flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              {run.status === "error" ? <span className="caps rounded-xs bg-slow-soft px-1.5 py-0.5 text-slow">Error</span> : <Verdict value={run.verdict ?? "PASS"} />}
              <span className="font-mono text-[11px] text-ink-3">run {selected + 1} of {runs.length}</span>
            </div>
            <p className="line-clamp-3 font-mono text-xs leading-5 break-all text-ink" title={run.sql}>{oneLine(run.sql)}</p>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line">
              {[
                ["time", formatMs(run.durationMs), (run.durationMs || 0) > threshold ? "text-slow" : "text-ink"],
                ["rows", run.rowCount == null ? "–" : formatNumber(run.rowCount), "text-ink"],
              ].map(([label, value, tone]) => (
                <div key={label} className="bg-bg px-3 py-2">
                  <p className="caps text-ink-3">{label}</p>
                  <p className={clsx("heading mt-1 text-[20px] leading-none", tone)}>{value}</p>
                </div>
              ))}
            </div>
            {run.error && <p className="line-clamp-2 text-xs text-slow">{run.error}</p>}
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => onOpen(run)}><Icons.workspace className="size-3.5" />Open</Button>
              {(run.verdict === "SLOW" || run.verdict === "WARN") && <Button size="sm" onClick={() => onOpen(run, true)} arrow>Fix it</Button>}
              <span className="ml-auto font-mono text-[11px] text-ink-3">{timeAgo(run.createdAt)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── KPI tile: a link to the page behind the number
function Kpi({ label, value, format, note, tone, bars, to, state, i = 0 }) {
  return (
    <Link to={to} state={state} className="group rise block" style={{ "--i": i }}>
      <Spotlight className="flex h-full flex-col justify-between rounded-md border border-line bg-subtle/40 p-4 transition-[border-color,transform] duration-300 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-line-2 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="caps text-ink-3 transition-colors group-hover:text-ink-2">{label}</p>
          <Icons.arrow className="size-3.5 -translate-x-1 -rotate-45 text-ink-3 opacity-0 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <p className="heading mt-3 text-[32px] leading-none">{value == null ? "–" : <CountUp value={value} format={format} />}</p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className={clsx("text-xs", tone === "bad" ? "text-slow" : tone === "warn" ? "text-warn" : "text-ink-3")}>{note}</p>
          {bars?.length > 1 && <MicroBars values={bars} className="hidden h-6 shrink-0 sm:flex" />}
        </div>
      </Spotlight>
    </Link>
  );
}

// ── Most expensive queries, re-sortable; rows glide to their new rank
const SORTS = [["totalMs", "Total time"], ["meanMs", "Per call"], ["calls", "Calls"]];
const ROW_H = 46;

function ExpensiveQueries({ items, onOpen }) {
  const [sort, setSort] = useState("totalMs");
  const ranked = useMemo(() => [...items].sort((a, b) => (b[sort] || 0) - (a[sort] || 0)), [items, sort]);
  const rank = new Map(ranked.map((q, i) => [q.id, i]));
  const max = Math.max(...items.map((q) => q[sort] || 0), 1);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="caps text-ink-3">rank by</span>
        <Tabs items={SORTS} value={sort} onChange={setSort} />
      </div>
      <ul className="relative" style={{ height: items.length * ROW_H }}>
        {items.map((q) => {
          const r = rank.get(q.id);
          return (
            <li key={q.id} className="absolute inset-x-0 transition-transform duration-500 ease-[var(--ease-out)]" style={{ transform: `translateY(${r * ROW_H}px)`, height: ROW_H }}>
              <button type="button" onClick={() => onOpen(q.query)} className="group relative flex h-full w-full items-center gap-4 overflow-hidden border-b border-line px-4 text-left transition-colors hover:bg-fill/50">
                <span className={clsx("absolute inset-y-0 left-0 transition-[width] duration-700 ease-[var(--ease-out)]", q.slow ? "bg-slow/10" : "bg-accent/10")} style={{ width: `${((q[sort] || 0) / max) * 100}%` }} />
                <span className="tabular relative w-5 shrink-0 font-mono text-[11px] text-ink-3">{String(r + 1).padStart(2, "0")}</span>
                <span className="relative min-w-0 flex-1 truncate font-mono text-xs" title={q.query}>{oneLine(q.query)}</span>
                <span className={clsx("tabular relative shrink-0 font-mono text-xs transition-colors", sort === "calls" ? "text-ink" : "text-ink-3")}>{formatNumber(q.calls)}×</span>
                <span className={clsx("tabular relative w-20 shrink-0 text-right font-mono text-xs", q.slow ? "text-slow" : "text-ink")}>{formatMs(sort === "totalMs" ? q.totalMs : q.meanMs)}</span>
                <Icons.arrow className="nudge relative size-3.5 shrink-0 text-ink-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Tables as dot clusters (1 dot ≈ 1,000 rows). Hover one to focus it;
// tables that appear in flagged queries glow.
function TableMap({ tables, hot, onOpen }) {
  const [focus, setFocus] = useState(null);
  if (!tables.length) return <p className="text-sm text-ink-2">No tables found in this database.</p>;
  const total = tables.reduce((n, t) => n + (t.rowEstimate || 0), 0) || 1;
  const shown = tables.find((t) => t.name === focus);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-6" onPointerLeave={() => setFocus(null)}>
        {tables.map((table, t) => {
          const dots = Math.min(400, Math.max(1, Math.round(table.rowEstimate / 1000)));
          const cols = Math.max(1, Math.min(24, Math.round(Math.sqrt(dots * 1.6))));
          const isHot = hot.has(table.name.toLowerCase());
          const dim = focus && focus !== table.name;
          return (
            <button
              key={table.name}
              type="button"
              onPointerEnter={() => setFocus(table.name)}
              onFocus={() => setFocus(table.name)}
              onClick={onOpen}
              className={clsx("rise flex flex-col gap-2 text-left transition-[opacity,filter] duration-300", dim && "opacity-30 grayscale")}
              style={{ "--i": t }}
            >
              <span className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 5px)` }} aria-hidden>
                {Array.from({ length: dots }, (_, i) => {
                  let h = Math.imul(i + 1, 2654435761) >>> 0;
                  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
                  const lit = isHot && (h ^ (h >>> 13)) % 100 < 32;
                  return <span key={i} className={clsx("size-[5px] rounded-[1px] transition-colors duration-300", lit ? "bg-accent" : focus === table.name ? "bg-ink-2" : "bg-line-2")} />;
                })}
              </span>
              <span className="flex items-center gap-2 font-mono text-xs">
                <span>{table.name}</span>
                <span className="text-ink-3">{compactRows(table.rowEstimate)}</span>
                {isHot && <Dot tone="accent" live />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex min-h-9 items-center gap-3 border-t border-line pt-3 font-mono text-[11px] text-ink-3">
        {shown ? (
          <span key={shown.name} className="swap flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink">{shown.name}</span>
            <span>{formatNumber(shown.rowEstimate)} rows</span>
            <span>{Math.round(((shown.rowEstimate || 0) / total) * 100)}% of the rows here</span>
            {hot.has(shown.name.toLowerCase()) ? <span className="text-accent-ink">in a flagged query</span> : <span>no flagged queries</span>}
          </span>
        ) : (
          <span>hover a table · 1 dot ≈ 1,000 rows · violet: tables in flagged queries</span>
        )}
      </div>
    </div>
  );
}

// ── What to look at next, with the button that does it
function Attention({ flagged, failing, navigate }) {
  const items = [
    ...failing.map((m) => ({ key: `m${m._id}`, tone: "bad", title: `${m.name} is failing`, meta: m.lastError ?? `last value ${formatNumber(m.lastValue)}`, action: <Button size="sm" variant="secondary" onClick={() => navigate("/app/monitors")}>View</Button> })),
    ...flagged.map((r) => ({
      key: `q${r._id}`,
      tone: r.verdict === "SLOW" ? "bad" : "warn",
      title: oneLine(r.sql),
      mono: true,
      meta: `${r.verdict} · ${formatMs(r.durationMs)} · ${timeAgo(r.createdAt)}`,
      action: <Button size="sm" variant="secondary" onClick={() => navigate("/app/advisor", { state: { sql: r.sql } })} arrow>Fix</Button>,
    })),
  ].slice(0, 6);

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <span className="relative grid size-10 place-items-center rounded-full border border-pass/30 bg-pass-soft text-pass">
          <span className="absolute inset-0 animate-ping rounded-full border border-pass/30 [animation-duration:2.4s]" aria-hidden />
          <Icons.check className="size-5" />
        </span>
        <p className="text-sm">Nothing needs you right now.</p>
        <p className="text-xs text-ink-3">Flagged queries and failing monitors show up here.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item, i) => (
        <li key={item.key} className="rise group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fill/40" style={{ "--i": i }}>
          <span className={clsx("absolute inset-y-0 left-0 w-[2px] origin-top scale-y-0 transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-y-100", item.tone === "bad" ? "bg-slow" : "bg-warn")} aria-hidden />
          <span className={clsx("grid size-7 shrink-0 place-items-center rounded-xs", item.tone === "bad" ? "bg-slow-soft text-slow" : "bg-warn-soft text-warn")}>
            {item.tone === "bad" ? <Icons.alert className="size-3.5" /> : <Icons.slow className="size-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={clsx("block truncate", item.mono ? "font-mono text-xs" : "text-sm")} title={item.title}>{item.title}</span>
            <span className="block truncate text-xs text-ink-3">{item.meta}</span>
          </span>
          {item.action}
        </li>
      ))}
    </ul>
  );
}

// ── Getting started, derived from what already exists
function Checklist({ steps }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-2">{done} of {steps.length} done</span>
        <span className="font-mono text-ink-3">{Math.round((done / steps.length) * 100)}%</span>
      </div>
      <div className="mt-2 flex gap-1">
        {steps.map((s, i) => <span key={s.label} className={clsx("grow-x h-1 flex-1 rounded-full", s.done ? "bg-accent" : "bg-fill")} style={{ "--i": i }} />)}
      </div>
      <ul className="mt-4 space-y-0.5">
        {steps.map((s, i) => (
          <li key={s.label} className="rise" style={{ "--i": i }}>
            <Link to={s.to} state={s.state} className={clsx("group flex items-center gap-3 rounded-xs px-2 py-2 transition-colors hover:bg-fill", s.done && "pointer-events-none")}>
              <span className={clsx("grid size-5 shrink-0 place-items-center rounded-full border transition-colors", s.done ? "border-accent bg-accent text-white" : "border-line-2 text-transparent group-hover:border-ink-3")}><Icons.check className="size-3" /></span>
              <span className={clsx("flex-1 text-sm", s.done ? "text-ink-3 line-through decoration-line-2" : "text-ink")}>{s.label}</span>
              {!s.done && <Icons.arrow className="nudge size-3.5 text-ink-3" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[300px]" />
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[122px]" />)}</div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2"><Skeleton className="h-[280px]" /><Skeleton className="h-[280px]" /></div>
    </div>
  );
}

// "updated 12s ago", ticking
function Freshness({ at, loading, onRefresh }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const seconds = at ? Math.round((Date.now() - at) / 1000) : 0;
  return (
    <button type="button" onClick={onRefresh} className="press group flex items-center gap-2 rounded-xs border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink" aria-label="Refresh">
      <Icons.refresh className={clsx("size-3.5 transition-transform duration-500 ease-[var(--ease-out)] group-hover:rotate-90", loading && "spin")} />
      <span className="tabular">{loading ? "refreshing…" : seconds < 5 ? "updated just now" : `updated ${seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`} ago`}</span>
    </button>
  );
}

function Dashboard({ connection, range, onState }) {
  const navigate = useNavigate();
  const ai = useSession((s) => s.ai);
  const [threshold, setThreshold] = useState(200);
  const [loadedAt, setLoadedAt] = useState(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const id = connection._id;
    const settle = (p) => p.then((value) => ({ value }), (err) => ({ error: err.message }));
    const [slow, schema, history, monitors, incidents, snapshots] = await Promise.all([
      settle(get(`/connections/${id}/slow-queries?sortBy=total&limit=6`)),
      settle(get(`/connections/${id}/schema`)),
      settle(get(`/history?connectionId=${id}&limit=100`)),
      settle(get(`/monitors?connectionId=${id}`)),
      settle(get("/incidents?status=open")),
      settle(get("/schema/snapshots")),
    ]);
    const monitorRuns = await Promise.all(
      (monitors.value ?? []).slice(0, 5).map((m) => get(`/monitors/${m._id}/runs?limit=30`).then((r) => [m._id, r.items], () => [m._id, []]))
    );
    return { slow, schema, history, monitors, incidents, snapshots, monitorRuns: Object.fromEntries(monitorRuns) };
  }, [connection._id]);

  useEffect(() => {
    if (data) setLoadedAt(Date.now());
  }, [data]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  const derived = useMemo(() => {
    if (!data) return null;
    const runs = (data.history.value?.items ?? []).slice().reverse();
    const ok = runs.filter((r) => r.status === "ok");
    const flaggedAll = ok.filter((r) => r.verdict === "WARN" || r.verdict === "SLOW");
    const seen = new Set();
    const flagged = flaggedAll.slice().reverse().filter((r) => !seen.has(oneLine(r.sql)) && seen.add(oneLine(r.sql)));
    const monitors = data.monitors.value ?? [];
    return {
      runs,
      ok,
      flaggedAll,
      flagged,
      hot: new Set(flaggedAll.flatMap((r) => tablesIn(r.sql))),
      monitors,
      failing: monitors.filter((m) => m.enabled && m.status === "failing"),
      tables: Object.values(data.schema.value?.tables ?? {}).sort((a, b) => b.rowEstimate - a.rowEstimate).slice(0, 8),
      openIncidents: (data.incidents.value ?? []).filter((i) => i.monitor?.connection === connection._id),
    };
  }, [data, connection._id]);

  // tell the header how things stand, in one sentence
  useEffect(() => {
    if (!derived) return;
    const { failing, flagged, runs } = derived;
    const name = connection.name;
    if (failing.length) onState({ tone: "bad", text: `${failing.length} monitor${failing.length === 1 ? " is" : "s are"} failing on ${name}.` });
    else if (flagged.length) onState({ tone: "warn", text: `${flagged.length} quer${flagged.length === 1 ? "y is" : "ies are"} slowing ${name} down.` });
    else if (runs.length) onState({ tone: "ok", text: `${name} is running clean.` });
    else onState({ tone: "idle", text: `${name} is connected. Run a query to wake the tape up.` });
  }, [derived, connection.name, onState]);

  const open = useCallback((sqlOrRun, fix) => {
    const sql = typeof sqlOrRun === "string" ? sqlOrRun : sqlOrRun.sql;
    navigate(fix ? "/app/advisor" : "/app/workspace", { state: { sql } });
  }, [navigate]);

  if (loading && !data) return <DashboardSkeleton />;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  const { runs, ok, flaggedAll, flagged, hot, monitors, failing, tables, openIncidents } = derived;
  const slowItems = data.slow.value?.items ?? [];
  const durations = ok.map((r) => r.durationMs || 0);
  const tapeRuns = runs.slice(-Number(range));

  const steps = [
    { label: "Connect a database", done: true, to: "/app/connections" },
    { label: "Run your first query", done: runs.length > 0, to: "/app/workspace" },
    { label: "Get a verdict on a slow query", done: flaggedAll.length > 0, to: "/app/slow-queries" },
    { label: "Turn a query into a monitor", done: monitors.length > 0, to: "/app/monitors", state: { create: true } },
    { label: "Save a schema snapshot", done: (data.snapshots.value ?? []).some((s) => s.connection === connection._id), to: "/app/schema" },
  ];
  const setupDone = steps.every((s) => s.done);
  const tableCard = (
    <Card title="Where reads go" icon={<Icons.layers className="size-3.5" />} meta={`${tables.length} largest tables`} action={<Button as={Link} to="/app/schema" variant="ghost" size="sm">Schema</Button>}>
      {data.schema.error ? <ErrorNote>{data.schema.error}</ErrorNote> : <TableMap tables={tables} hot={hot} onOpen={() => navigate("/app/schema")} />}
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Run tape"
        icon={<Icons.history className="size-3.5" />}
        meta="every run, oldest to newest"
        className="rise"
        bodyClassName="p-0"
        action={<Freshness at={loadedAt} loading={loading} onRefresh={reload} />}
      >
        <RunTape key={range} runs={tapeRuns} slots={Math.max(Number(range), tapeRuns.length)} threshold={threshold} onThreshold={setThreshold} onOpen={open} />
      </Card>

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 xl:grid-cols-4">
        <Kpi i={1} to="/app/history" label="Runs" value={runs.length} note={runs.length ? "in recent history" : "nothing yet"} />
        <Kpi i={2} to="/app/history" label="Median time" value={median(durations)} format={(n) => formatMs(n)} note="across recent runs" bars={durations.slice(-16)} />
        <Kpi i={3} to="/app/slow-queries" label="Flagged" value={flagged.length} note={flagged.length ? "distinct queries to fix" : "no problems found"} tone={flagged.length ? "warn" : undefined} />
        <Kpi i={4} to="/app/monitors" label="Monitors" value={monitors.length} note={failing.length ? `${failing.length} failing · ${openIncidents.length} open incident${openIncidents.length === 1 ? "" : "s"}` : monitors.length ? "all passing" : "none set up"} tone={failing.length ? "bad" : undefined} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title="Needs attention" icon={<Icons.bell className="size-3.5" />} meta={flagged.length + failing.length ? `${flagged.length + failing.length} item${flagged.length + failing.length === 1 ? "" : "s"}` : "all clear"} bodyClassName="p-0">
          <Attention flagged={flagged} failing={failing} navigate={navigate} />
        </Card>
        {setupDone ? tableCard : (
          <Card title="Get set up" icon={<Icons.bolt className="size-3.5" />} meta="five steps to a faster database">
            <Checklist steps={steps} />
            {!ai.enabled && <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">AI is off on this server. Set GROQ_API_KEY to ask questions in plain English.</p>}
          </Card>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Most expensive queries" icon={<Icons.bolt className="size-3.5" />} meta="from the database's own stats" action={<Button as={Link} to="/app/slow-queries" variant="ghost" size="sm">View all</Button>} bodyClassName="p-0">
          {data.slow.error ? (
            <div className="flex items-start gap-3 p-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-warn-soft text-warn"><Icons.alert className="size-3.5" /></span>
              <div className="min-w-0">
                <p className="text-sm">Query stats aren't switched on yet.</p>
                <p className="mt-1 font-mono text-xs leading-5 break-words text-ink-3">{data.slow.error}</p>
              </div>
            </div>
          ) : slowItems.length ? (
            <ExpensiveQueries items={slowItems} onOpen={open} />
          ) : (
            <p className="px-4 py-8 text-sm text-ink-2">No query stats recorded yet.</p>
          )}
        </Card>

        <Card title="Monitors" icon={<Icons.monitors className="size-3.5" />} meta="last 30 runs" action={<Button as={Link} to="/app/monitors" variant="ghost" size="sm">Manage</Button>}>
          {monitors.length ? (
            <ul className="space-y-4">
              {monitors.slice(0, 5).map((m, mi) => {
                const strip = (data.monitorRuns[m._id] ?? []).slice().reverse();
                return (
                  <li key={m._id} className="group">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><Dot tone={!m.enabled ? "idle" : m.status === "failing" ? "bad" : m.status === "passing" ? "ok" : "idle"} live={m.enabled && m.status === "failing"} /><span className="truncate">{m.name}</span></span>
                      <span className="caps shrink-0 text-ink-3">{m.enabled ? m.status : "paused"}</span>
                    </div>
                    <div className="mt-2 flex gap-[2px]">
                      {Array.from({ length: 30 }, (_, i) => {
                        const run = strip[strip.length - 30 + i];
                        return <span key={i} title={run ? `${run.passed ? "passed" : "failed"} · ${formatMs(run.durationMs)} · ${timeAgo(run.createdAt)}` : undefined} className={clsx("grow-y h-5 flex-1 rounded-[1px] transition-transform duration-200 hover:scale-y-125", !run ? "bg-fill" : run.passed ? "bg-pass/45 group-hover:bg-pass/60" : "bg-slow")} style={{ "--i": i + mi * 3 }} />;
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-ink-2">No monitors yet. A monitor re-runs a query on a schedule and alerts you when it drifts.</p>
              <Button size="sm" variant="secondary" onClick={() => navigate("/app/monitors", { state: { create: true } })} arrow>Create one</Button>
            </div>
          )}
        </Card>
      </div>

      {setupDone ? null : tableCard}
    </div>
  );
}

const TONE_TEXT = { bad: "text-slow", warn: "text-warn", ok: "text-pass", idle: "text-ink-3" };

export default function Overview() {
  const connection = useCurrentConnection();
  const { openAddConnection } = useOutletContext();
  const user = useSession((s) => s.user);
  const first = user?.fullName?.split(" ")[0] ?? "there";
  const [range, setRange] = useState("48");
  const [state, setState] = useState(null);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="min-w-0">
          <p className="eyebrow rise">{connection ? `${engineLabel(connection.type)} · ${connection.host}:${connection.port}/${connection.database}` : "Overview"}</p>
          <h1 className="heading rise mt-3 text-[28px] leading-[34px] sm:text-[38px] sm:leading-[44px]" style={{ "--i": 1 }}>{greeting()}, {first}.</h1>
          <p className="rise mt-2 flex min-h-5 items-center gap-2 text-sm text-ink-2" style={{ "--i": 2 }}>
            {connection && state ? (
              <span key={state.text} className="swap flex items-center gap-2">
                <Dot tone={state.tone} live={state.tone !== "idle"} />
                <span className={clsx(TONE_TEXT[state.tone], "sr-only")}>{state.tone}</span>
                {state.text}
              </span>
            ) : connection ? (
              <span className="text-ink-3">Reading {connection.name}…</span>
            ) : (
              "Connect a database to see where its time goes."
            )}
          </p>
        </div>
        {connection && (
          <div className="rise flex flex-wrap items-center gap-2" style={{ "--i": 3 }}>
            <Tabs items={RANGES} value={range} onChange={setRange} />
            <Button as={Link} to="/app/workspace" size="sm" arrow>Open workspace</Button>
          </div>
        )}
      </div>
      {connection ? (
        <Dashboard key={connection._id} connection={connection} range={range} onState={setState} />
      ) : (
        <Empty icon={<Icons.connections className="size-5" />} title="Connect your first database" action={<Button size="sm" onClick={openAddConnection} arrow>Add a connection</Button>}>
          PostgreSQL, MySQL or MongoDB. Quereo tests the connection before saving it, and keeps it read-only unless you say otherwise. The sample databases fill in with one click.
        </Empty>
      )}
    </div>
  );
}
