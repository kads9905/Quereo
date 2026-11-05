import clsx from "clsx";
import { Verdict } from "../ui";

// Product UI drawn for the marketing pages, using real numbers measured by
// Quereo on its sample database (400,000 orders in PostgreSQL).

export function UiCard({ title, meta, children, className }) {
  return (
    <div className={clsx("rounded-md border border-line bg-bg shadow-[0_32px_64px_-24px_rgb(0_0_0/0.75)]", className)}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-xs"><span className="size-1.5 bg-accent" />{title}</span>
        {meta && <span className="caps text-ink-3">{meta}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function VerdictVisual() {
  return (
    <UiCard title="orders · customer_id = 42" meta="14.4 ms">
      <div className="flex items-center gap-2"><Verdict value="WARN" /><span className="text-sm">3 of 4 checks passed</span></div>
      <ul className="mt-4 space-y-1.5 text-sm">
        {[["Runs in under 200 ms", true], ["No full scans of large tables", false], ["Sorts fit in memory", true], ["Row estimates are accurate", true]].map(([n, ok], i) => (
          <li key={n} className="rise flex gap-2" style={{ "--i": i + 1 }}><span className={clsx("font-mono text-xs", ok ? "text-pass" : "text-warn")}>{ok ? "✓" : "✕"}</span><span className={ok ? "text-ink-2" : ""}>{n}</span></li>
        ))}
      </ul>
      <p className="mt-4 rounded-xs bg-fill px-3 py-2 font-mono text-xs">Seq Scan · read 400,000 rows to return 20</p>
    </UiCard>
  );
}

export function AdvisorVisual() {
  const Bar = ({ label, value, share, bright, i }) => (
    <div>
      <div className="flex justify-between text-xs"><span className="text-ink-2">{label}</span><span className="tabular font-mono">{value}</span></div>
      <div className="mt-1.5 h-1.5 bg-fill"><div className={clsx("grow-x h-full", bright ? "bg-accent" : "bg-ink")} style={{ width: `${share}%`, "--i": i }} /></div>
    </div>
  );
  return (
    <UiCard title="Index trial" meta="rolled back">
      <code className="block font-mono text-xs text-ink">CREATE INDEX ON orders (customer_id);</code>
      <div className="mt-4 space-y-3">
        <Bar label="Before · rows read" value="400,000" share={100} i={1} />
        <Bar label="After · rows read" value="20" share={1.5} bright i={4} />
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
        <span className="tabular font-mono text-xs text-ink-2">14.4 ms → 0.05 ms</span>
        <span className="font-mono text-lg tracking-[-0.03em]">287× faster</span>
      </div>
    </UiCard>
  );
}

export function MonitorVisual() {
  const strips = [
    ["Cancelled orders < 60k", [27, 28, 29], "93.3%"],
    ["Customer lookup < 50 ms", [], "100%"],
    ["Order totals are positive", [], "100%"],
  ];
  return (
    <div className="space-y-3">
      <UiCard title="Monitors" meta="last 30 runs">
        <ul className="space-y-3.5">
          {strips.map(([name, fails, uptime], s) => (
            <li key={name}>
              <div className="flex justify-between text-sm"><span>{name}</span><span className={clsx("tabular font-mono text-xs", fails.length ? "text-slow" : "text-ink-3")}>{uptime}</span></div>
              <div className="mt-1.5 flex gap-[2px]">{Array.from({ length: 30 }, (_, i) => <span key={i} className={clsx("grow-y h-4 flex-1", fails.includes(i) ? "bg-slow" : "bg-line-2")} style={{ "--i": i + s * 4 }} />)}</div>
            </li>
          ))}
        </ul>
      </UiCard>
      <div className="rise ml-8 rounded-md border border-line bg-bg p-3 text-sm shadow-[0_32px_64px_-24px_rgb(0_0_0/0.7)]" style={{ "--i": 8 }}>
        <span className="caps text-ink-3"># db-alerts</span>
        <p className="mt-1"><span className="text-slow">●</span> Cancelled orders &lt; 60k is failing: 61,204 is not &lt; 60,000</p>
      </div>
    </div>
  );
}

export function SchemaVisual() {
  const rows = [
    ["BREAKING", "Table order_items was removed"],
    ["BREAKING", "orders.total_cents: integer → numeric(12,2)"],
    ["WARNING", "Index idx_products_name was removed"],
    ["INFO", "New column customers.phone (text)"],
  ];
  const tone = { BREAKING: "bg-slow-soft text-slow", WARNING: "bg-warn-soft text-warn", INFO: "bg-fill text-ink-2" };
  return (
    <UiCard title="prod → staging" meta="2 breaking">
      <ul className="space-y-2">
        {rows.map(([level, text], i) => (
          <li key={text} className="rise flex items-start gap-3 text-sm" style={{ "--i": i + 1 }}>
            <span className={clsx("caps w-[74px] shrink-0 rounded-xs px-1.5 py-0.5 text-center", tone[level])}>{level}</span>
            <span className="font-mono text-xs leading-5">{text}</span>
          </li>
        ))}
      </ul>
    </UiCard>
  );
}

export function AiVisual() {
  const lines = ["SELECT c.city, SUM(o.total_cents) AS value", "FROM orders o", "JOIN customers c ON c.id = o.customer_id", "WHERE o.created_at >= now() - interval '30 days'", "GROUP BY c.city", "ORDER BY value DESC", "LIMIT 5;"];
  return (
    <UiCard title="Ask in plain English" meta="Groq">
      <p className="rounded-xs bg-fill px-3 py-2 text-sm">Top 5 cities by order value this month<span className="caret ml-0.5 text-accent">▍</span></p>
      <pre className="mt-3 overflow-x-auto font-mono text-xs leading-5 text-ink-2">
        {lines.map((line, i) => <span key={i} className="rise block" style={{ "--i": i + 2 }}>{line}</span>)}
      </pre>
      <p className="rise mt-3 flex items-center gap-2 text-xs text-pass" style={{ "--i": 10 }}><span>✓</span>Checked with EXPLAIN · not run</p>
    </UiCard>
  );
}

export const FEATURES = [
  {
    tab: "Verdict",
    title: "Know why it's slow.",
    text: "Every run is checked against its real execution plan and comes back PASS, WARN or SLOW, with the line that caused it.",
    points: ["Reads EXPLAIN ANALYZE for you", "Flags full scans and disk sorts", "Same checks on every engine"],
    visual: VerdictVisual,
  },
  {
    tab: "Index Advisor",
    title: "Prove the fix first.",
    text: "Quereo suggests the index the plan is missing, builds it, times the query again and removes it. Your database is left as it was.",
    points: ["Suggestions straight from the plan", "Before and after, on your data", "Finds indexes nobody uses"],
    visual: AdvisorVisual,
  },
  {
    tab: "Monitors",
    title: "Hear about it first.",
    text: "Turn any query into a check on a schedule. When it drifts, an incident opens and your channel gets one clear message.",
    points: ["Value, row count or duration checks", "Uptime and p95 per monitor", "Slack and Discord webhooks"],
    visual: MonitorVisual,
  },
  {
    tab: "Schema diff",
    title: "Catch breaking changes.",
    text: "Compare staging with production, or today with last week's snapshot, before a deploy finds the difference for you.",
    points: ["Live databases or saved snapshots", "Breaking, warning and info levels", "Works on MongoDB too"],
    visual: SchemaVisual,
  },
  {
    tab: "Ask in English",
    title: "Queries you can trust.",
    text: "Describe what you need and Quereo writes the query, then checks it against your database before showing it to you.",
    points: ["Validated with EXPLAIN", "Never runs anything on its own", "Only table structure is sent"],
    visual: AiVisual,
  },
];
