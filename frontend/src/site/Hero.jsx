import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Results Quereo measured on its sample databases, shown one after another
const FEED = [
  { engine: "PG", query: "orders · customer_id = 42", ms: "14.4 ms", verdict: "WARN" },
  { engine: "PG", query: "index trial · orders (customer_id)", ms: "0.05 ms", verdict: "PASS" },
  { engine: "MY", query: "orders · customer_id = 42", ms: "272 ms", verdict: "SLOW" },
  { engine: "PG", query: "orders · id = 42", ms: "0.02 ms", verdict: "PASS" },
  { engine: "MG", query: "orders · { status: 'cancelled' }", ms: "12.9 ms", verdict: "WARN" },
  { engine: "MY", query: "index trial · orders (customer_id)", ms: "0.16 ms", verdict: "PASS" },
];

const TONE = {
  PASS: ["text-pass", "bg-pass-soft text-pass"],
  WARN: ["text-warn", "bg-warn-soft text-warn"],
  SLOW: ["text-slow", "bg-slow text-white"],
};

// The "live" badge above the headline: cycles through real query results
export function LiveTicker({ interval = 2600 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % FEED.length), interval);
    return () => clearInterval(id);
  }, [interval]);
  const item = FEED[i];
  const [msTone, pill] = TONE[item.verdict];
  return (
    <div className="inline-flex max-w-full items-center gap-3 overflow-hidden rounded-xs border border-line bg-bg/85 py-1.5 pr-1.5 pl-1.5 font-mono text-xs backdrop-blur" aria-live="polite">
      <span className="shrink-0 rounded-[2px] bg-fill px-2 py-0.5 text-ink-3">live</span>
      <span key={i} className="ticker flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-accent-ink">{item.engine}</span>
        <span className="truncate text-ink">{item.query}</span>
        <span className={clsx("shrink-0 whitespace-nowrap", msTone)}>{item.ms}</span>
        <span className={clsx("caps shrink-0 rounded-[2px] px-1.5 py-0.5 font-medium", pill)}>{item.verdict}</span>
      </span>
    </div>
  );
}

// Product window that starts tipped back and swooshes upright as it scrolls into view
export function Swoosh({ children, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || still()) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const top = node.getBoundingClientRect().top;
      // 0 while the window's top is at the bottom of the screen, 1 once it reaches 15% from the top
      const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.85)));
      const e = 1 - Math.pow(1 - p, 3);
      node.style.transform = `perspective(1800px) translateY(${(1 - e) * 90}px) rotateX(${(1 - e) * 24}deg) scale(${0.88 + 0.12 * e})`;
      node.style.opacity = String(0.35 + 0.65 * e);
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
  return (
    <div ref={ref} className={clsx("origin-top will-change-transform", className)}>
      {children}
    </div>
  );
}
