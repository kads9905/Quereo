import { useEffect, useRef } from "react";
import clsx from "clsx";

// Columns of short dashes drifting downward: a stream of queries.
// Violet runs are normal traffic; the bright head of a run is a slow one.
// Canvas, paused off screen, one still frame under reduced motion.

const PITCH = 15;  // px between dash rows
const DASH_H = 3;
const COL_GAP = 40;
const DASH_W = 28;

function makeColumn(seed, rows) {
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // A few runs per column, each with its own speed and length
  return Array.from({ length: 2 + Math.floor(rand() * 2) }, () => ({
    y: rand() * rows,
    length: 6 + Math.floor(rand() * 18),
    speed: 1.2 + rand() * 2.6, // rows per second
    hot: 2 + Math.floor(rand() * 5),
  }));
}

export function SignalColumns({ columns = 4, align = "left", className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let rows = 0;
    let streams = [];
    let frame = 0;
    let visible = true;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rows = Math.ceil(height / PITCH) + 1;
      streams = Array.from({ length: columns }, (_, c) => makeColumn(c + (align === "left" ? 1 : 11), rows));
    };

    const draw = (dt) => {
      ctx.clearRect(0, 0, width, height);
      for (let c = 0; c < columns; c++) {
        // Columns nearer the content are fuller; outer ones fade out
        const fromEdge = align === "left" ? c : columns - 1 - c;
        const x = align === "left" ? c * COL_GAP : width - (columns - c) * COL_GAP + (COL_GAP - DASH_W);
        const presence = 0.35 + 0.65 * (fromEdge / Math.max(1, columns - 1));
        for (const run of streams[c]) {
          run.y += run.speed * dt;
          if (run.y - run.length > rows) run.y = -Math.random() * rows * 0.5;
        }
        for (let r = 0; r < rows; r++) {
          let tone = 0; // 0 none, 1 faint, 2 violet, 3 hot
          for (const run of streams[c]) {
            const d = run.y - r;
            if (d >= 0 && d < run.hot) tone = Math.max(tone, 3);
            else if (d >= 0 && d < run.length) tone = Math.max(tone, 2);
            else if (d >= -3 && d < run.length + 4) tone = Math.max(tone, 1);
          }
          if (!tone) continue;
          // Fade toward the top and bottom of the band
          const v = r / rows;
          const edge = Math.min(1, v / 0.12, (1 - v) / 0.12);
          const alpha = (tone === 3 ? 0.95 : tone === 2 ? 0.75 : 0.22) * edge * presence;
          ctx.fillStyle = tone === 3 ? `rgba(244,244,245,${alpha})` : `rgba(122,103,255,${alpha})`;
          ctx.fillRect(x, r * PITCH, DASH_W, DASH_H);
        }
      }
    };

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(dt);
      if (visible) frame = requestAnimationFrame(tick);
    };

    resize();
    if (still) {
      draw(0);
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(frame);
      if (visible) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    });
    observer.observe(canvas);
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [columns, align]);

  return <canvas ref={canvasRef} aria-hidden className={clsx("pointer-events-none block", className)} style={{ width: columns * COL_GAP - (COL_GAP - DASH_W) }} />;
}

// Square mosaic band for the closing section: violet and graphite tiles
export function MosaicBand({ className, seed = 5, cols = 24, rows = 5 }) {
  let s = seed;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const shades = ["#1a1a1e", "#232328", "#2d2a44", "#3a3270", "#5b4bd6", "#7a67ff", "#141416"];
  return (
    <svg className={clsx("block w-full", className)} viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden shapeRendering="crispEdges">
      {Array.from({ length: cols * rows }, (_, i) => {
        const r = Math.floor(i / cols);
        // Brighter tiles cluster toward the bottom rows
        const bias = r / (rows - 1);
        const pick = Math.min(shades.length - 1, Math.floor(random() * 4 + bias * 3));
        return <rect key={i} x={i % cols} y={r} width="1.02" height="1.02" fill={shades[pick]} />;
      })}
    </svg>
  );
}
