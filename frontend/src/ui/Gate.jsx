import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Q_CORE, Q_PIXELS } from ".";
import { Decode } from "./fx";
import { useGate } from "../store/gate";

// The Q's ring in drawing order: clockwise from the top, then the tail
const RING = [[1, 0], [2, 0], [3, 0], [4, 0], [5, 1], [5, 2], [5, 3], [5, 4], [4, 5], [3, 5], [2, 5], [1, 5], [0, 4], [0, 3], [0, 2], [0, 1], [4, 4], [5, 5], [6, 6]];
const ORDER = RING.filter(([x, y]) => Q_PIXELS.some(([a, b]) => a === x && b === y));
const DUST = 72;

// small deterministic random, so a gate looks the same on every render
const rand = (seed) => {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
};

const first = (name) => (name?.trim().split(/\s+/)[0] || "there").toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What each gate says: one big word, a greeting, and the steps it ticks through
const SCRIPTS = {
  open: (g) => ({
    word: "quereo",
    hello: g.isNew ? `welcome, ${first(g.name)}` : `welcome back, ${first(g.name)}`,
    route: "quereo://open",
    steps: ["checking session", `loading ${plural(g.connections ?? 0, "database")}`, "attaching monitors", "warming workspace", "ready"],
  }),
  close: (g) => ({
    word: "see you",
    hello: `signing out, ${first(g.name)}`,
    route: "quereo://close",
    steps: ["clearing session", "forgetting open database", "monitors keep running", "signed out"],
  }),
  drop: (g) => ({
    word: "dropped",
    hello: `goodbye, ${first(g.name)}`,
    route: "quereo://drop --cascade",
    steps: [`dropping ${plural(g.counts?.connections ?? 0, "connection")}`, `dropping ${plural(g.counts?.monitors ?? 0, "monitor")}`, `dropping ${plural(g.counts?.history ?? 0, "history row")}`, "account deleted"],
  }),
};

// Pixels drifting across the screen. Opening: they stream into the centre.
// Closing: they burst outward. Dropping: they rain down.
function Dust({ kind }) {
  const dots = useMemo(() => {
    const r = rand(7);
    return Array.from({ length: DUST }, (_, i) => {
      const x = r() * 100;
      const y = r() * 100;
      return { i, x, y, size: 2 + Math.round(r() * 4), dx: 50 - x, dy: 50 - y, dur: 900 + r() * 1100, delay: r() * 900, lit: r() < 0.22 };
    });
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {dots.map((d) => (
        <span
          key={d.i}
          className={clsx("absolute rounded-[1px]", `warp-dust-${kind}`, d.lit ? (kind === "drop" ? "bg-slow" : "bg-accent") : "bg-ink-3")}
          style={{
            left: `${d.x}vw`,
            top: `${d.y}vh`,
            width: d.size,
            height: d.size,
            "--dx": `${d.dx}vw`,
            "--dy": `${d.dy}vh`,
            animationDuration: `${d.dur}ms`,
            animationDelay: `${d.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

// The giant Q, one div per pixel so each can fly, scatter or fall on its own
function BigQ({ kind, leaving, ms }) {
  const cells = useMemo(() => {
    const r = rand(kind.length + 3);
    return ORDER.map(([x, y], i) => {
      const angle = r() * Math.PI * 2;
      const dist = 45 + r() * 40;
      return { x, y, i, fx: `${Math.cos(angle) * dist}vw`, fy: `${Math.sin(angle) * dist}vh`, rot: `${Math.round((r() - 0.5) * 540)}deg` };
    });
  }, [kind]);
  const coreAt = kind === "open" ? Math.min(1150, ms * 0.42) : 0;

  return (
    <div className="warp-q" style={{ "--q": "min(30vmin, 236px)" }}>
      {cells.map((c) => (
        <span
          key={`${c.x}-${c.y}`}
          className={clsx("absolute bg-ink", `warp-cell-${kind}`)}
          style={{
            left: `calc(var(--q) / 7 * ${c.x})`,
            top: `calc(var(--q) / 7 * ${c.y})`,
            width: "calc(var(--q) / 7 * 0.86)",
            height: "calc(var(--q) / 7 * 0.86)",
            "--fx": c.fx,
            "--fy": c.fy,
            "--rot": c.rot,
            animationDelay: kind === "open" ? `${c.i * 38}ms` : kind === "close" ? `${300 + (ORDER.length - c.i) * 34}ms` : `${450 + ((c.i * 7) % ORDER.length) * 55}ms`,
          }}
        />
      ))}
      {/* the core: lands last on open */}
      <span
        className={clsx("absolute", kind === "drop" ? "bg-slow" : "bg-accent", `warp-core-${kind}`)}
        style={{ left: "calc(var(--q) / 7 * 2)", top: "calc(var(--q) / 7 * 2)", width: "calc(var(--q) / 7 * 2)", height: "calc(var(--q) / 7 * 2)", animationDelay: `${coreAt}ms` }}
      />
    </div>
  );
}

function useElapsed(ms) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = setInterval(() => setT(Math.min(ms, performance.now() - start)), 40);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

export function Gate() {
  const { gate, leaving } = useGate();
  if (!gate) return null;
  return <GateScreen key={`${gate.kind}-${gate.ms}`} gate={gate} leaving={leaving} />;
}

function GateScreen({ gate, leaving }) {
  const script = SCRIPTS[gate.kind](gate);
  const elapsed = useElapsed(gate.ms);
  const progress = elapsed / gate.ms;
  const step = Math.min(script.steps.length - 1, Math.floor(progress * script.steps.length * 1.08));
  const dropping = gate.kind === "drop";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${script.hello}. ${script.steps[step]}`}
      className={clsx("warp fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-bg", leaving && "warp-leave")}
    >
      {/* grid floor and glow */}
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [background-size:48px_48px] [mask-image:radial-gradient(circle_at_center,black,transparent_65%)]" aria-hidden />
      <div
        className="warp-glow pointer-events-none absolute top-1/2 left-1/2 size-[70vmin] rounded-full blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${dropping ? "rgb(255 92 92 / 0.16)" : "rgb(122 103 255 / 0.22)"}, transparent)` }}
        aria-hidden
      />
      <Dust kind={gate.kind} />

      {/* corner readouts */}
      <div className="warp-hud pointer-events-none absolute inset-0 p-5 font-mono text-[11px] text-ink-3 sm:p-8" aria-hidden>
        <span className="absolute top-5 left-5 sm:top-8 sm:left-8">{script.route}</span>
        <span className="tabular absolute top-5 right-5 sm:top-8 sm:right-8">{(elapsed / 1000).toFixed(2)}s</span>
        <span className="absolute bottom-5 left-5 hidden sm:bottom-8 sm:left-8 sm:block">{gate.email ?? "session"} · read-only</span>
        <span className={clsx("tabular absolute right-5 bottom-5 sm:right-8 sm:bottom-8", dropping ? "text-slow" : "text-accent-ink")}>{String(Math.round(progress * 100)).padStart(3, "0")}%</span>
      </div>

      <div className="relative flex flex-col items-center">
        <BigQ kind={gate.kind} leaving={leaving} ms={gate.ms} />

        <div className={clsx("warp-copy relative z-10 mt-[7vmin] flex flex-col items-center text-center", leaving && "warp-copy-out")}>
          <p className="font-mono text-[12px] tracking-[0.2em] text-ink-3 uppercase">{script.hello}</p>
          <p className="heading mt-3 text-[52px] leading-none sm:text-[76px]">
            <Decode text={script.word} speed={34} className={dropping ? "text-ink-2 line-through decoration-slow decoration-[3px]" : undefined} />
            <span className={clsx("ml-[0.04em] inline-block size-[0.14em]", dropping ? "bg-slow" : "bg-accent")} aria-hidden />
          </p>
          <div className="mt-6 flex h-5 items-center gap-2.5 font-mono text-[12px]">
            <span className={clsx("size-1.5 rounded-full", dropping ? "bg-slow" : step === script.steps.length - 1 ? "bg-pass" : "bg-accent", "animate-pulse")} />
            <span key={step} className="swap text-ink-2">{script.steps[step]}</span>
          </div>
          <div className="mt-4 h-px w-[220px] bg-line">
            <div className={clsx("h-full origin-left", dropping ? "bg-slow" : "bg-accent")} style={{ transform: `scaleX(${progress})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
