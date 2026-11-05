import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LogoMark } from "../ui";
import { Eyebrow, Note, Reveal, Words, useInView } from "../ui/motion";
import { PixelScene } from "./PixelArt";
import { scrollToTarget } from "./smooth";

const pad = (n) => String(n).padStart(2, "0");
const clamp = (v) => Math.min(1, Math.max(0, v));
// Progress of t through the window [a, b], 0 → 1
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const typed = (text, p) => text.slice(0, Math.round(text.length * p));
const num = (n) => Math.round(n).toLocaleString("en-US");

// ── Dark product panel frame
function Panel({ label, meta, footer, children }) {
  return (
    <div className="ink flex h-full min-h-[360px] flex-col overflow-hidden rounded-md shadow-[0_40px_80px_-30px_rgb(0_0_0/0.55)]">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <span className="flex items-center gap-2.5"><LogoMark className="size-3.5" /><span className="caps text-ink">{label}</span></span>
        <span className="truncate font-mono text-[11px] text-ink-3">{meta}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-5">{children}</div>
      <div className="border-t border-line px-5 py-3 font-mono text-[11px] text-ink-3">{footer}</div>
    </div>
  );
}

const Mark = ({ ok, on }) => (
  <span className={clsx("grid size-5 shrink-0 place-items-center rounded-[3px] text-[11px] transition-colors duration-300", !on ? "bg-fill text-ink-3" : ok ? "bg-pass-soft text-pass" : "bg-slow-soft text-slow")}>{ok ? "✓" : "✕"}</span>
);

// 01 — checks light up one by one as you scroll
function VerdictPanel({ t }) {
  const checks = [
    ["Runs in under 200 ms", "14.4 ms", true],
    ["No full scans of large tables", "400,000 rows", false],
    ["Sorts fit in memory", "no sort", true],
    ["Row estimates are accurate", "20 ≈ 21", true],
  ];
  const lit = checks.map((_, i) => t > 0.12 + i * 0.15);
  const done = lit.filter(Boolean).length;
  const passed = checks.filter((c, i) => lit[i] && c[2]).length;
  return (
    <Panel label="Verdict" meta="pg-shop · read-only" footer={`${done} / 4 checks · ${passed} passed · 14.4 ms`}>
      <p className="truncate rounded-xs border border-line bg-subtle px-3 py-2 font-mono text-xs text-ink-2"><span className="text-accent-ink">SELECT</span> id, total_cents <span className="text-accent-ink">FROM</span> orders <span className="text-accent-ink">WHERE</span> customer_id = 42</p>
      <ul className="mt-4 space-y-2">
        {checks.map(([name, value, ok], i) => (
          <li key={name} className={clsx("flex items-center gap-3 rounded-xs border px-3 py-2.5 font-mono text-[13px] transition-[opacity,background-color,border-color] duration-300", !lit[i] ? "border-transparent opacity-25" : ok ? "border-line bg-subtle/60" : "border-slow/30 bg-slow-soft")}>
            <Mark ok={ok} on={lit[i]} />
            <span className="flex-1 truncate">{name}</span>
            <span className="text-ink-3">{value}</span>
          </li>
        ))}
      </ul>
      <div className={clsx("mt-auto flex items-center gap-3 pt-4 transition-[opacity,transform] duration-500 ease-[var(--ease-out)]", t > 0.78 ? "opacity-100" : "translate-y-2 opacity-0")}>
        <span className="caps rounded-[3px] bg-warn px-1.5 py-0.5 font-medium text-black">WARN</span>
        <span className="text-sm text-ink-2">Seq Scan read 400,000 rows to return 20.</span>
      </div>
    </Panel>
  );
}

// 02 — the index is typed, built and measured; the after-bar collapses
function AdvisorPanel({ t }) {
  const p = easeOut(seg(t, 0.3, 0.75));
  const statement = "CREATE INDEX ON orders (customer_id);";
  const after = 400000 - (400000 - 20) * p;
  return (
    <Panel label="Index trial" meta="orders (customer_id)" footer={t > 0.85 ? "✓ trial index removed · database unchanged" : t > 0.3 ? "measuring on your data…" : "building the index…"}>
      <p className="font-mono text-[13px] text-ink">{typed(statement, seg(t, 0.02, 0.25))}<span className={clsx("ml-0.5 text-accent", t < 0.27 ? "caret" : "opacity-0")}>▍</span></p>
      <p className="heading mt-6 text-[64px] leading-none sm:text-[80px]">{Math.round(1 + 286 * p)}<span className="text-accent">×</span><span className="ml-3 font-sans text-sm tracking-normal text-ink-3">faster</span></p>
      <div className="mt-auto space-y-4">
        <div className={clsx("transition-opacity duration-500", t > 0.08 ? "opacity-100" : "opacity-0")}>
          <div className="flex justify-between font-mono text-xs"><span className="text-ink-3">before · rows read</span><span>400,000 · 14.4 ms</span></div>
          <div className="mt-2 h-2 bg-fill"><div className="h-full bg-ink-2" /></div>
        </div>
        <div className={clsx("transition-opacity duration-500", t > 0.3 ? "opacity-100" : "opacity-0")}>
          <div className="flex justify-between font-mono text-xs"><span className="text-ink-3">after · rows read</span><span className="text-accent-ink">{num(after)} · {(14.4 - (14.4 - 0.05) * p).toFixed(2)} ms</span></div>
          <div className="mt-2 h-2 bg-fill"><div className="h-full bg-accent" style={{ width: `${Math.max(0.6, (after / 400000) * 100)}%` }} /></div>
        </div>
      </div>
    </Panel>
  );
}

// 03 — run history marches in, spikes, and an incident opens
const BARS = Array.from({ length: 46 }, (_, i) => (i === 31 ? 100 : i === 32 ? 86 : 26 + ((i * 37) % 23)));
function MonitorPanel({ t }) {
  const shown = Math.floor(BARS.length * seg(t, 0.05, 0.75));
  return (
    <Panel label="Monitor" meta="customer lookup · every 1m" footer={<span className="flex items-center gap-2"><span className="size-1.5 bg-pass" />99.9% uptime · p95 31 ms</span>}>
      <p className="heading text-[64px] leading-none sm:text-[80px]">{Math.round(31 * easeOut(seg(t, 0, 0.35)))}<span className="ml-3 font-mono text-sm tracking-normal text-ink-3">ms p95</span></p>
      <div className="mt-auto flex h-40 items-end gap-[4px] pt-6">
        {BARS.map((h, i) => (
          <span
            key={i}
            className={clsx("flex-1 rounded-[1px] transition-[height,background-color] duration-300 ease-[var(--ease-out)]", i >= shown ? "bg-line" : i === 31 || i === 32 ? "bg-slow" : "bg-ink-3/70")}
            style={{ height: i < shown ? `${h}%` : "3px" }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[11px] text-ink-3">
        <span>48m ago</span>
        <span className={clsx("text-slow transition-opacity duration-500", t > 0.72 ? "opacity-100" : "opacity-0")}>incident opened · resolved after 2 runs</span>
        <span>now</span>
      </div>
    </Panel>
  );
}

// 04 — schema lines appear, then the diff lights up
const SCHEMA = [
  ["", "orders:"],
  ["", "  columns:"],
  ["", "    id: bigint"],
  ["", "    customer_id: integer"],
  ["-", "    total_cents: integer"],
  ["+", "    total_cents: numeric(12,2)"],
  ["", "    created_at: timestamptz"],
  ["", "  indexes:"],
  ["-", "    idx_orders_customer_id"],
];
function SchemaPanel({ t }) {
  const marked = t > 0.5;
  return (
    <Panel label="Schema diff" meta="production → staging" footer={t > 0.75 ? "2 breaking changes · 1 query affected" : "comparing…"}>
      <pre className="-mx-5 font-mono text-[13px] leading-7">
        {SCHEMA.map(([mark, line], i) => {
          const visible = t > i * 0.045;
          const on = marked && mark;
          return (
            <div key={i} className={clsx("flex px-5 transition-[opacity,background-color,color] duration-300", visible ? "opacity-100" : "opacity-0", on === "-" && "bg-slow-soft text-slow", on === "+" && "bg-pass-soft text-pass")}>
              <span className="w-6 shrink-0 text-ink-3">{mark}</span>
              <span>{line}</span>
            </div>
          );
        })}
      </pre>
    </Panel>
  );
}

// 05 — the question types, then the query, then the check
const SQL = "SELECT c.city, SUM(o.total_cents) AS value\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.created_at >= now() - interval '30 days'\nGROUP BY c.city\nORDER BY value DESC\nLIMIT 5;";
function AiPanel({ t }) {
  const q = "Top 5 cities by order value this month";
  return (
    <Panel label="Ask in English" meta="groq · structure only" footer="sent: 2 table definitions · 0 rows">
      <p className="self-start rounded-xs border border-line bg-subtle px-3 py-2 text-sm">{typed(q, seg(t, 0, 0.18))}<span className={clsx("ml-0.5 text-accent", t < 0.2 ? "caret" : "opacity-0")}>▍</span></p>
      <pre className="mt-4 overflow-hidden font-mono text-[13px] leading-6 whitespace-pre-wrap text-ink-2">{typed(SQL, seg(t, 0.22, 0.72))}<span className={clsx("text-accent", t > 0.22 && t < 0.74 ? "caret" : "opacity-0")}>▍</span></pre>
      <p className={clsx("mt-auto flex items-center gap-2 pt-4 text-sm text-pass transition-[opacity,transform] duration-500", t > 0.78 ? "opacity-100" : "translate-y-2 opacity-0")}>✓ Checked with EXPLAIN · not run</p>
    </Panel>
  );
}

const STEPS = [
  {
    tab: "verdict",
    scene: "lens",
    title: "Read the plan, not the logs.",
    text: "Every run is checked against its real execution plan. You get PASS, WARN or SLOW, and the step in the plan that caused it.",
    chips: ["EXPLAIN ANALYZE, read for you", "Full scans & disk sorts", "Same checks on 3 engines"],
    Panel: VerdictPanel,
  },
  {
    tab: "advisor",
    scene: "bolt",
    title: "Prove the fix before you ship it.",
    text: "Quereo builds the index the plan is missing, times the query again, then removes it. You see the speed-up on your own data.",
    chips: ["Suggestions from the plan", "Before & after, measured", "Rolled back every time"],
    Panel: AdvisorPanel,
  },
  {
    tab: "monitors",
    scene: "pulse",
    title: "It keeps watching after you stop.",
    text: "Turn any query into a check on a schedule. When it drifts past its limit, an incident opens and your channel gets one clear message.",
    chips: ["Every minute to every day", "Uptime & p95", "Slack, Discord, webhooks"],
    Panel: MonitorPanel,
  },
  {
    tab: "schema",
    scene: "diff",
    title: "Catch the breaking change first.",
    text: "Compare staging with production, or today with last week's snapshot. Dropped columns and changed types are flagged before a deploy finds them.",
    chips: ["Live or snapshot", "Breaking, warning, info", "Inferred MongoDB schemas"],
    Panel: SchemaPanel,
  },
  {
    tab: "ask",
    scene: "type",
    title: "Ask in English. Trust the answer.",
    text: "Describe what you need and Quereo writes the query, then checks it with EXPLAIN before you see it. It never runs anything on its own.",
    chips: ["Validated with EXPLAIN", "Self-corrects once", "Structure only, never rows"],
    Panel: AiPanel,
  },
];

function StepCard({ step, index, t }) {
  const { Panel: StepPanel } = step;
  return (
    <article
      className="grid h-full grid-cols-[minmax(0,1fr)] overflow-hidden rounded-md border border-line bg-bg shadow-[0_40px_90px_-50px_rgb(0_0_0/0.35)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]"
    >
      <div className="flex min-h-0 flex-col">
        <div className="ink relative h-[220px] shrink-0 lg:h-[44%]">
          <PixelScene scene={step.scene} />
          <span className="absolute top-3 left-4 font-mono text-[11px] text-ink-3">fig.{pad(index + 1)} / {step.tab}</span>
        </div>
        <div className="flex flex-1 flex-col p-6 sm:p-8">
          <h3 className="heading text-[26px] leading-[32px] sm:text-[32px] sm:leading-[38px]">{step.title}</h3>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-[26px] text-ink-2">{step.text}</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            {step.chips.map((c) => <span key={c} className="rounded-full border border-line-2 px-3 py-1 font-mono text-[11px] text-ink-2">{c}</span>)}
          </div>
        </div>
      </div>
      <div className="border-t border-line bg-subtle p-4 sm:p-6 lg:border-t-0 lg:border-l">
        <StepPanel t={t} />
      </div>
    </article>
  );
}

// Phones: each card plays its panel once it scrolls into view
function AutoStep({ step, index }) {
  const [ref, shown] = useInView({ threshold: 0.35 });
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!shown) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 3200);
      setT(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown]);
  return <div ref={ref}><StepCard step={step} index={index} t={t} /></div>;
}

// The product, one card per stretch of scrolling: the section pins, the deck
// moves with the scroll, and each card's panel plays by itself when it arrives.
export function Story() {
  const pinRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const steps = STEPS.length;

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const node = pinRef.current;
      if (!node || !node.offsetParent) return;
      const rect = node.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      setProgress(clamp(-rect.top / Math.max(1, total)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // The scroll position maps straight onto the deck: no holds, no fades.
  // Lenis smooths the wheel, so the deck glides exactly as fast as you scroll.
  const pos = progress * (steps - 1); // fractional card index on screen
  const active = Math.min(steps - 1, Math.max(0, Math.round(pos)));
  // Panels play on their own: when a card becomes the active one, its panel
  // animates once over a few seconds. Cards already passed stay finished.
  const [play, setPlay] = useState(0);
  const inSection = progress > 0 && progress < 1;
  useEffect(() => {
    if (!inSection) return undefined;
    setPlay(0);
    let frame = 0;
    const start = performance.now() + 200;
    const tick = (now) => {
      const p = clamp((now - start) / 3400);
      setPlay(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, inSection]);
  const tOf = (i) => (i < active ? 1 : i > active ? 0 : play);
  // Two ways to move between cards: "slide" (sideways strip, the default) and
  // "stack" (each card rises over the last). Compare with ?story=stack
  const mode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("story") === "stack" ? "stack" : "slide";
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const jump = (i) => {
    const node = pinRef.current;
    const total = node.offsetHeight - window.innerHeight;
    scrollToTarget(node.getBoundingClientRect().top + window.scrollY + (total * i) / (steps - 1));
  };

  return (
    <section id="product" className="light grid-bg scroll-mt-16">
      <div className="gutter grid grid-cols-[minmax(0,1fr)] gap-10 pt-24 pb-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end lg:pt-32">
        <div>
          <Eyebrow text="Product" />
          <Words lines={["One place to run,", "judge and fix."]} className="heading mt-6 text-[40px] leading-[44px] sm:text-[64px] sm:leading-[66px]" />
        </div>
        <Reveal i={3} className="max-w-[44ch] lg:justify-self-end">
          <p className="text-md text-ink-2 sm:text-lg sm:leading-[30px]">The query runner, the plan reader, the index tester and the monitor you'd otherwise keep four tabs open for. One workspace.</p>
          <Note className="mt-6">keep scrolling. each panel below is playing a real check.</Note>
        </Reveal>
      </div>

      {/* Desktop: pinned, scroll-driven */}
      <div ref={pinRef} data-pin className="relative hidden lg:block" style={{ height: `${steps * 85}vh` }}>
        <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col justify-center gap-7 overflow-hidden py-8">
          {mode === "slide" ? (
            /* The deck: every card side by side, translated as one strip */
            <div
              className="flex h-[min(600px,calc(100vh-12rem))] will-change-transform"
              style={{ width: `${steps * 100}%`, transform: `translate3d(${(-pos * 100) / steps}%, 0, 0)` }}
            >
              {STEPS.map((s, i) => (
                <div key={s.tab} className="h-full px-[var(--gutter)]" style={{ width: `${100 / steps}%` }} aria-hidden={i !== active}>
                  <div className="mx-auto h-full max-w-[var(--content)]">
                    <StepCard step={s} index={i} t={still ? 1 : tOf(i)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* The stack: each card rises from below and settles over the last,
               which steps back a little, like cards dealt onto a pile */
            <div className="gutter">
              <div className="relative mx-auto h-[min(600px,calc(100vh-12rem))] max-w-[var(--content)]">
                {STEPS.map((s, i) => {
                  const below = pos - i; // > 0 once cards have landed on top of this one
                  const rising = i === Math.floor(pos) + 1 ? pos - Math.floor(pos) : null;
                  let transform;
                  if (below >= 0) {
                    const d = Math.min(below, 3);
                    transform = `translate3d(0, ${-d * 18}px, 0) scale(${1 - d * 0.045})`;
                  } else if (rising !== null) {
                    transform = `translate3d(0, ${(1 - easeOut(rising)) * 100}vh, 0)`;
                  } else {
                    transform = "translate3d(0, 100vh, 0)";
                  }
                  return (
                    <div key={s.tab} className="absolute inset-0 origin-top will-change-transform" style={{ transform, zIndex: i }} aria-hidden={i !== active}>
                      <StepCard step={s} index={i} t={still ? 1 : tOf(i)} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="gutter grid grid-cols-5 gap-4">
            {STEPS.map((s, i) => {
              const fill = i <= active ? 1 : 0;
              return (
                <button key={s.tab} type="button" onClick={() => jump(i)} className="group text-left">
                  <span className="block h-[2px] bg-line-2">
                    <span className="block h-full origin-left bg-accent transition-transform duration-500 ease-[var(--ease-out)]" style={{ transform: `scaleX(${fill})` }} />
                  </span>
                  <span className={clsx("mt-3 flex gap-2 font-mono text-xs transition-colors duration-200", i === active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")}>
                    <span className="text-accent-ink">{pad(i + 1)}</span>{s.tab}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Phones and tablets: stacked, each plays when it arrives */}
      <div className="gutter flex flex-col gap-8 pb-24 lg:hidden">
        {STEPS.map((s, i) => <Reveal key={s.tab}><AutoStep step={s} index={i} /></Reveal>)}
      </div>
    </section>
  );
}
