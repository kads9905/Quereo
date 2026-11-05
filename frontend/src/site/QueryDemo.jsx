import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Verdict } from "../ui";

// The landing page demo: Quereo's real job on the sample database
// (400,000 orders in PostgreSQL). The numbers were measured by the Quereo
// backend on that database.

const TABLE_ROWS = 400_000;

const QUERIES = [
  {
    id: "customer",
    label: "One customer's orders",
    sql: ["SELECT id, total_cents, created_at", "FROM orders", "WHERE customer_id = 42;"],
    result: {
      verdict: "WARN", durationMs: 14.4, rowsRead: 400_000, rowsReturned: 20, plan: "Seq Scan on orders",
      checks: [["Runs in under 200 ms", true], ["No full scans of large tables", false], ["Sorts fit in memory", true], ["Row estimates are accurate", true]],
      finding: "Full table scan: Postgres read all 400,000 orders to find the 20 for customer 42.",
    },
    fix: {
      statement: "CREATE INDEX ON orders (customer_id);",
      why: "With an index on customer_id, Postgres jumps straight to the matching rows.",
      after: { durationMs: 0.05, rowsRead: 20, plan: "Index Scan on orders", speedup: 287 },
    },
  },
  {
    id: "status",
    label: "Everything but pending",
    sql: ["SELECT id, total_cents", "FROM orders", "WHERE status <> 'pending';"],
    result: {
      verdict: "WARN", durationMs: null, rowsRead: 400_000, rowsReturned: 342_858, plan: "Seq Scan on orders",
      checks: [["No full scans of large tables", false], ["Row estimates are accurate", true]],
      finding: "Full table scan on orders, but this query really does need almost every row.",
    },
    noFix: "No index suggested. 6 in 7 orders match, so one pass over the table is already the cheapest plan.",
  },
  {
    id: "pk",
    label: "One order by id",
    sql: ["SELECT id, total_cents, created_at", "FROM orders", "WHERE id = 42;"],
    result: {
      verdict: "PASS", durationMs: 0, rowsRead: 1, rowsReturned: 1, plan: "Index Scan using orders_pkey",
      checks: [["Runs in under 200 ms", true], ["No full scans of large tables", true], ["Sorts fit in memory", true], ["Row estimates are accurate", true]],
      finding: null,
    },
    noFix: "Primary key lookup, one row read. Nothing to fix.",
  },
];

const RUN_MS = 700;
const TRIAL_MS = 1_100;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rows = (n) => Math.round(n).toLocaleString("en-US");
const ms = (v) => (v == null ? "" : v === 0 ? "<1 ms" : `${v} ms`);

function useCountTo(target, duration = 600) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced()) {
      setValue(target);
      from.current = target;
      return undefined;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(origin + (target - origin) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function SqlLine({ text }) {
  return text.split(/('[^']*'|\b\d+\b|\b(?:SELECT|FROM|WHERE|CREATE|INDEX|ON)\b)/g).map((part, i) => {
    if (!part) return null;
    if (/^'.*'$/.test(part)) return <span key={i} className="text-pass">{part}</span>;
    if (/^\d+$/.test(part)) return <span key={i} className="text-accent-ink">{part}</span>;
    if (/^(SELECT|FROM|WHERE|CREATE|INDEX|ON)$/.test(part)) return <span key={i} className="text-ink">{part}</span>;
    return <span key={i} className="text-ink-2">{part}</span>;
  });
}

function Pending({ label }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="text-sm text-ink-2">{label}</span>
      <div className="h-0.5 w-40 overflow-hidden bg-fill"><div className="scan h-full w-1/4 bg-ink" /></div>
    </div>
  );
}

function RowsBar({ read, returned }) {
  const shown = useCountTo(read);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="caps text-ink-3">Rows read</span>
        <span className="tabular font-mono text-sm">{rows(shown)} <span className="text-ink-3">/ {rows(TABLE_ROWS)}</span></span>
      </div>
      <div className="mt-2 h-1.5 bg-fill">
        <div className="h-full origin-left bg-ink transition-transform duration-700 ease-[var(--ease-out)]" style={{ transform: `scaleX(${Math.max(read / TABLE_ROWS, 0.004)})` }} />
      </div>
      <p className="mt-2 text-xs text-ink-3">to return <span className="tabular font-mono text-ink-2">{rows(returned)}</span> {returned === 1 ? "row" : "rows"}</p>
    </div>
  );
}

export function QueryDemo({ bare = false }) {
  const [queryId, setQueryId] = useState(QUERIES[0].id);
  const [phase, setPhase] = useState("idle"); // idle → running → result → trying → fixed
  const timer = useRef(0);
  const rootRef = useRef(null);
  const query = QUERIES.find((q) => q.id === queryId);

  const after = (wait, next) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(next, reduced() ? 0 : wait);
  };
  const run = () => {
    setPhase("running");
    after(RUN_MS, () => setPhase("result"));
  };

  // Runs the first query once it scrolls into view
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect();
        after(400, run);
      }
    }, { threshold: 0.4 });
    observer.observe(rootRef.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer.current);
    };
  }, []);

  const fixed = phase === "fixed";
  const r = query.result;
  const passed = r.checks.filter(([, ok]) => ok).length;

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          run();
        }
      }}
      className={clsx("overflow-hidden text-left", !bare && "rounded-md border border-line bg-bg shadow-[0_40px_80px_-32px_rgb(0_0_0/0.8)]")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-subtle px-3 py-2">
        <div role="tablist" aria-label="Sample queries" className="flex flex-wrap gap-1">
          {QUERIES.map((q) => (
            <button
              key={q.id}
              role="tab"
              type="button"
              aria-selected={q.id === queryId}
              onClick={() => {
                clearTimeout(timer.current);
                setQueryId(q.id);
                setPhase("idle");
              }}
              className={clsx("press rounded-xs px-2.5 py-1.5 text-sm", q.id === queryId ? "bg-bg font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:text-ink")}
            >
              {q.label}
            </button>
          ))}
        </div>
        <span className="caps flex items-center gap-2 text-ink-3">
          <span className="size-1.5 rounded-full bg-pass" aria-hidden />
          shop · PostgreSQL 16 · read-only
        </span>
      </div>

      <div className="grid lg:grid-cols-2">
        <div className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
          <pre className="flex-1 overflow-x-auto py-5 font-mono text-sm leading-7" aria-label="Query">
            {query.sql.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-12 shrink-0 pr-4 text-right text-ink-3 select-none">{i + 1}</span>
                <code><SqlLine text={line} /></code>
              </div>
            ))}
            {fixed && (
              <div className="rise mt-4 flex">
                <span className="w-12 shrink-0 pr-4 text-right text-pass select-none">+</span>
                <code className="text-pass">{query.fix.statement}</code>
              </div>
            )}
          </pre>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span className="text-xs text-ink-3">Sample data · 400,000 orders</span>
            <button
              type="button"
              onClick={run}
              disabled={phase === "running" || phase === "trying"}
              className="press caps group inline-flex h-8 items-center gap-2 rounded-xs bg-ink px-3.5 font-medium text-bg hover:bg-ink/85 disabled:opacity-40"
            >
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden><path d="M2 1.2v7.6L8.5 5z" fill="currentColor" /></svg>
              Run
            </button>
          </div>
        </div>

        <div className="min-h-[360px] p-5 sm:p-6" aria-live="polite">
          {phase === "idle" && (
            <div className="flex h-full flex-col justify-center text-sm">
              <p className="text-ink">Press Run to see what Quereo finds.</p>
              <p className="mt-1 text-ink-3">It reads the plan, checks it, and suggests a fix if there is one.</p>
            </div>
          )}
          {phase === "running" && <div className="flex h-full items-center"><Pending label="Reading the query plan…" /></div>}

          {(phase === "result" || phase === "trying" || fixed) && (
            <div className="flex flex-col gap-6">
              <div className="rise flex flex-wrap items-center gap-x-3 gap-y-2">
                <Verdict value={fixed ? "PASS" : r.verdict} />
                <span className="text-sm">{fixed ? `${query.fix.after.speedup}× faster with the index` : `${passed} of ${r.checks.length} checks passed`}</span>
                <span className="tabular ml-auto font-mono text-xs text-ink-2">
                  {fixed ? `${ms(r.durationMs)} → ${ms(query.fix.after.durationMs)}` : ms(r.durationMs)}
                </span>
              </div>

              <div className="rise" style={{ "--i": 1 }}>
                <RowsBar read={fixed ? query.fix.after.rowsRead : r.rowsRead} returned={r.rowsReturned} />
                <p className="mt-3 font-mono text-xs text-ink-2">{fixed ? query.fix.after.plan : r.plan}</p>
              </div>

              {!fixed && (
                <ul className="rise grid gap-1.5 text-sm sm:grid-cols-2" style={{ "--i": 2 }}>
                  {r.checks.map(([name, ok]) => (
                    <li key={name} className="flex items-center gap-2">
                      <span aria-hidden className={clsx("font-mono text-xs", ok ? "text-pass" : "text-warn")}>{ok ? "✓" : "✕"}</span>
                      <span className={ok ? "text-ink-2" : "text-ink"}>{name}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!fixed && r.finding && <p className="rise text-sm" style={{ "--i": 3 }}>{r.finding}</p>}

              {query.fix && !fixed && (
                <div className="rise rounded-xs border border-dashed border-line-2 p-4" style={{ "--i": 4 }}>
                  {phase === "trying" ? (
                    <Pending label="Building the index and re-running, inside a transaction that's rolled back…" />
                  ) : (
                    <>
                      <p className="caps text-ink-3">Suggested fix</p>
                      <code className="mt-1.5 block font-mono text-sm">{query.fix.statement}</code>
                      <p className="mt-2 text-sm text-ink-2">{query.fix.why}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setPhase("trying");
                          after(TRIAL_MS, () => setPhase("fixed"));
                        }}
                        className="press caps mt-4 inline-flex h-8 items-center rounded-xs bg-ink px-3 font-medium text-bg hover:bg-ink/85"
                      >
                        Try this index
                      </button>
                    </>
                  )}
                </div>
              )}

              {fixed && (
                <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-xs bg-pass-soft px-4 py-3" style={{ "--i": 2 }}>
                  <p className="text-sm">The index was rolled back. Your database is exactly as it was.</p>
                  <button type="button" onClick={run} className="caps press text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">Run again</button>
                </div>
              )}

              {!query.fix && query.noFix && <p className="rise rounded-xs bg-fill p-4 text-sm text-ink-2" style={{ "--i": 4 }}>{query.noFix}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
