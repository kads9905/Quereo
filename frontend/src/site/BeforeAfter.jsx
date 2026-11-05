import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LogoMark } from "../ui";
import { Icons } from "../ui/icons";
import { Eyebrow, Note, Reveal, Words, useInView } from "../ui/motion";

const clamp = (v) => Math.min(1, Math.max(0, v));

// 0 when the element's top is at `start` of the viewport, 1 when its bottom reaches `end`
export function useScrollProgress(ref, start = 0.85, end = 0.75) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setP(1);
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const node = ref.current;
      if (!node) return;
      const vh = window.innerHeight;
      const r = node.getBoundingClientRect();
      setP(clamp((vh * start - r.top) / (r.height + vh * (start - end))));
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
  }, [ref, start, end]);
  return p;
}

// ── The old way: paper, raw text, worry

function OldWindow({ title, children }) {
  return (
    <div className="flex h-full flex-col bg-[#f6f5f1] text-[#2b2b2e]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#e3e1da] px-4 font-mono text-[11px] text-[#8a8a91]">
        <span className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-2 rounded-full bg-[#dcdad3]" />)}</span>
        <span className="ml-2">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-5 sm:p-6">{children}</div>
    </div>
  );
}

const Mono = ({ children, className }) => <p className={clsx("font-mono text-[12.5px] leading-6 whitespace-pre-wrap", className)}>{children}</p>;

const Chat = ({ who, time, children, tone }) => (
  <div className="flex gap-3">
    <span className={clsx("grid size-7 shrink-0 place-items-center rounded-sm text-[11px] font-semibold text-white", tone)}>{who[0].toUpperCase()}</span>
    <div className="min-w-0">
      <p className="text-[12px]"><span className="font-semibold">{who}</span> <span className="text-[#8a8a91]">{time}</span></p>
      <p className="text-[14px] leading-snug">{children}</p>
    </div>
  </div>
);

// ── The Quereo way: one dark panel, one answer

function NewWindow({ label, meta, footer, children }) {
  return (
    <div className="ink flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <LogoMark className="size-3.5" />
        <span className="caps text-ink-2">{label}</span>
        <span className="ml-auto truncate font-mono text-[11px] text-ink-3">{meta}</span>
      </div>
      <div className="min-h-0 flex-1 p-5 sm:p-6">{children}</div>
      <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3">{footer}</div>
    </div>
  );
}

const SCENARIOS = [
  {
    key: "slow",
    tab: "It's slow",
    before: (
      <OldWindow title="psql · prod">
        <Mono className="text-[#6b6b72]">=&gt; EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;</Mono>
        <Mono className="mt-2">{`Seq Scan on orders  (cost=0.00..8456.00 rows=21 width=36)
  (actual time=0.031..14.372 rows=20 loops=1)
  Filter: (customer_id = 42)
  Rows Removed by Filter: 399980
Planning Time: 0.094 ms
Execution Time: 14.401 ms`}</Mono>
        <Mono className="mt-4 text-[#c2410c]">-- is 399980 a lot? asking for a friend</Mono>
      </OldWindow>
    ),
    after: (
      <NewWindow label="Verdict" meta="orders · customer_id = 42" footer="3 of 4 checks passed · 14.4 ms">
        <div className="flex items-center gap-2.5"><span className="caps rounded-[3px] bg-warn px-1.5 py-0.5 font-medium text-black">WARN</span><span className="text-sm">One problem worth fixing</span></div>
        <p className="heading mt-5 text-[22px] leading-[28px] sm:text-[26px] sm:leading-[32px]">Read 400,000 rows to return 20.</p>
        <p className="mt-3 max-w-[44ch] text-sm text-ink-2">A full table scan on orders. An index on customer_id lets the database jump straight to the rows it needs.</p>
        <div className="mt-5 flex items-center gap-3 rounded-sm border border-dashed border-line-2 px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">CREATE INDEX ON orders (customer_id);</code>
          <span className="shrink-0 rounded-sm bg-ink px-2.5 py-1 text-xs font-medium text-bg">Try it</span>
        </div>
      </NewWindow>
    ),
  },
  {
    key: "fix",
    tab: "You fix it",
    before: (
      <OldWindow title="#eng-db">
        <div className="space-y-4">
          <Chat who="dev" time="14:02" tone="bg-[#6b6b72]">added an index on orders.customer_id in prod 🤞</Chat>
          <Chat who="dev" time="14:05" tone="bg-[#6b6b72]">is it faster? feels faster. maybe?</Chat>
          <Chat who="lead" time="14:11" tone="bg-[#c2410c]">did you try it on staging first</Chat>
          <Chat who="dev" time="14:26" tone="bg-[#6b6b72]">…define "try"</Chat>
        </div>
      </OldWindow>
    ),
    after: (
      <NewWindow label="Index trial" meta="orders (customer_id)" footer="✓ trial index removed · database unchanged">
        <p className="heading text-[56px] leading-none sm:text-[72px]">287<span className="text-accent">×</span><span className="ml-3 font-sans text-sm tracking-normal text-ink-3">faster, measured</span></p>
        <div className="mt-6 space-y-3">
          {[["before", "400,000 rows · 14.4 ms", 100, "bg-ink-2"], ["after", "20 rows · 0.05 ms", 1.5, "bg-accent"]].map(([k, v, w, bg]) => (
            <div key={k}>
              <div className="flex justify-between font-mono text-xs"><span className="text-ink-3">{k}</span><span>{v}</span></div>
              <div className="mt-1.5 h-2 bg-fill"><div className={clsx("h-full", bg)} style={{ width: `${w}%` }} /></div>
            </div>
          ))}
        </div>
      </NewWindow>
    ),
  },
  {
    key: "drift",
    tab: "It drifts again",
    before: (
      <OldWindow title="support inbox · 3 unread">
        <ul className="divide-y divide-[#e3e1da] text-[14px]">
          {[["11:03", "Re: Re: checkout is slow", "still slow?? we have a launch today"], ["10:15", "Re: checkout is slow", "any update on this?"], ["09:42", "checkout is slow", "pages are taking forever to load since this morning"]].map(([t, subj, body]) => (
            <li key={t} className="flex gap-4 py-3">
              <span className="font-mono text-[11px] text-[#8a8a91]">{t}</span>
              <span className="min-w-0"><span className="block truncate font-semibold">{subj}</span><span className="block truncate text-[#6b6b72]">{body}</span></span>
            </li>
          ))}
        </ul>
        <Mono className="mt-3 text-[#c2410c]">-- first you heard of it: 09:42</Mono>
      </OldWindow>
    ),
    after: (
      <NewWindow label="Monitor" meta="customer lookup < 50 ms · every 1m" footer="alert sent to #db-alerts at 09:04 · resolved 09:21">
        <div className="flex items-center gap-2.5"><span className="live size-1.5 rounded-full bg-slow text-slow" /><span className="text-sm">Incident opened at 09:03</span></div>
        <p className="heading mt-5 text-[22px] leading-[28px] sm:text-[26px] sm:leading-[32px]">p95 went from 31 ms to 212 ms.</p>
        <p className="mt-3 text-sm text-ink-2">You knew 39 minutes before the first customer did.</p>
        <div className="mt-6 flex gap-[3px]">
          {Array.from({ length: 40 }, (_, i) => <span key={i} className={clsx("h-6 flex-1 rounded-[1px]", i >= 26 && i <= 29 ? "bg-slow" : "bg-pass/45")} />)}
        </div>
      </NewWindow>
    ),
  },
];

const PROOF = [
  ["layers", "Plan-aware", "EXPLAIN on every run, across PostgreSQL, MySQL and MongoDB."],
  ["slow", "Latency budgets", "p50, p95 and uptime for every monitor, every run kept."],
  ["check", "Read-only first", "Writes stay off until you switch them on, per connection."],
  ["connections", "One small server", "A Node API and a MongoDB. Deploy it wherever you like."],
];

// Two layers in one frame; the handle decides how much of each you see
function Compare({ scenario }) {
  const frameRef = useRef(null);
  const [ref, inView] = useInView();
  const [split, setSplit] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const swept = useRef(false);

  // The first time it scrolls in, the handle sweeps across to show it moves
  useEffect(() => {
    if (!inView || swept.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    swept.current = true;
    let frame = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const t = clamp((now - t0) / 1800);
      const e = 1 - Math.pow(1 - t, 3);
      setSplit(0.94 - 0.44 * e);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView]);

  const moveTo = useCallback((clientX) => {
    const r = frameRef.current.getBoundingClientRect();
    setSplit(Math.min(0.97, Math.max(0.03, (clientX - r.left) / r.width)));
  }, []);

  return (
    <div ref={ref}>
      {/* Phones: the two sides stacked */}
      <div className="flex flex-col gap-3 md:hidden">
        <div key={`mb-${scenario.key}`} className="swap h-[380px] overflow-hidden rounded-md border border-line-2">{scenario.before}</div>
        <div key={`ma-${scenario.key}`} className="swap h-[380px] overflow-hidden rounded-md border border-line-2">{scenario.after}</div>
      </div>
      {/* Wider screens: one frame, drag the line */}
      <div
        ref={frameRef}
        className={clsx("relative hidden h-[460px] touch-pan-y overflow-hidden rounded-md border border-line-2 shadow-[0_40px_90px_-60px_rgb(0_0_0/0.5)] select-none md:block sm:h-[420px]", dragging ? "cursor-grabbing" : "cursor-ew-resize")}
        onPointerDown={(e) => {
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => dragging && moveTo(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {/* Two panes that share the frame: the handle sets where one ends and the other begins.
            Each keeps a sensible minimum width, so text reflows instead of squashing. */}
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${split * 100}%` }}>
          <div key={`b-${scenario.key}`} className="swap h-full w-full min-w-[300px]">{scenario.before}</div>
        </div>
        <div className="absolute inset-y-0 right-0 flex justify-end overflow-hidden" style={{ width: `${(1 - split) * 100}%` }}>
          <div key={`a-${scenario.key}`} className="swap h-full w-full min-w-[300px] shrink-0">{scenario.after}</div>
        </div>

        {/* corner labels */}
        <span className="caps pointer-events-none absolute bottom-3 left-3 rounded-[3px] bg-[#2b2b2e]/85 px-2 py-1 text-white transition-opacity duration-300" style={{ opacity: split > 0.18 ? 1 : 0 }}>the old way</span>
        <span className="caps pointer-events-none absolute right-3 bottom-3 rounded-[3px] bg-accent px-2 py-1 text-white transition-opacity duration-300" style={{ opacity: split < 0.82 ? 1 : 0 }}>with quereo</span>

        {/* the handle */}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: `${split * 100}%` }}>
          <span className={clsx("absolute top-1/2 left-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-accent bg-white text-accent shadow-[0_8px_24px_-6px_rgb(122_103_255/0.6)] transition-transform duration-200", dragging && "scale-110")}>
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 4 2 8l4 4M10 4l4 4-4 4" /></svg>
          </span>
        </div>
        <input
          type="range"
          min="3"
          max="97"
          value={Math.round(split * 100)}
          onChange={(e) => setSplit(Number(e.target.value) / 100)}
          aria-label="Compare the old way with Quereo"
          className="sr-only"
        />
      </div>
    </div>
  );
}

export function BeforeAfter() {
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[index];

  return (
    <section id="why" className="light grid-bg scroll-mt-16">
      <div className="gutter py-24 lg:py-32">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <Eyebrow text="Why Quereo" />
            <Words lines={["Same database.", "Very different morning."]} dim={[1]} className="heading mt-6 text-[34px] leading-[38px] sm:text-[48px] sm:leading-[54px]" />
          </div>
          <Reveal i={3} className="max-w-[44ch] lg:justify-self-end">
            <p className="text-md text-ink-2 sm:text-lg sm:leading-[30px]">On the left, how a slow query usually gets found and fixed. On the right, the same moment with Quereo. Drag the line.</p>
            <Note className="mt-6">go on, drag it. it's read-only.</Note>
          </Reveal>
        </div>

        <Reveal i={1} className="mt-12 flex flex-wrap items-center gap-2" role="tablist" aria-label="Scenarios">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={clsx("press flex items-center gap-2.5 rounded-sm border px-3.5 py-2 text-sm transition-colors duration-300", i === index ? "border-ink bg-ink text-bg" : "border-line-2 bg-bg text-ink-2 hover:border-ink-3 hover:text-ink")}
            >
              <span className={clsx("font-mono text-[11px]", i === index ? "text-accent-ink" : "text-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
              {s.tab}
            </button>
          ))}
        </Reveal>

        <Reveal i={2} className="mt-5">
          <Compare scenario={scenario} />
        </Reveal>

        <ul className="mt-14 grid grid-cols-1 overflow-hidden rounded-md border border-line-2 bg-bg sm:grid-cols-2 lg:grid-cols-4">
          {PROOF.map(([icon, title, body], i) => {
            const Icon = Icons[icon];
            return (
              <Reveal
                as="li"
                key={title}
                i={i}
                className="group border-b border-line-2 p-6 transition-colors duration-300 last:border-b-0 hover:bg-[#0b0b0c] hover:text-[#f4f4f5] sm:odd:border-r lg:border-r lg:border-b-0 lg:last:border-r-0"
              >
                <Icon className="size-5 transition-colors duration-300 group-hover:text-accent" />
                <p className="caps mt-5">{title}</p>
                <p className="mt-2 max-w-[30ch] text-sm leading-snug opacity-60">{body}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
