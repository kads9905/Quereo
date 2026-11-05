import { useState } from "react";
import clsx from "clsx";
import { useInView } from "../ui/motion";

// The landing page signs off with just the name, set huge and bold, closed by
// the violet square from the logo, blinking like a console cursor. Hover the
// square (or tap it) and its pixels fly apart and rebuild themselves into the
// pixel Q logo, growing up into the space beside the word; let go and the Q
// folds back down into the blinking cursor.

const NAME = "quereo";
const SIDE = 5; // the cursor is a 5×5 grid of pixels

// The logo's pixel Q on a 7×7 grid (same cells as the LogoMark)
const Q_RING = [[1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [0, 2], [0, 3], [0, 4], [5, 1], [5, 2], [5, 3], [5, 4], [1, 5], [2, 5], [3, 5], [4, 5], [4, 4], [5, 5], [6, 6]];
const Q_CORE = [[2, 2], [3, 2], [2, 3], [3, 3]];

// Sizes in em of the word's font size
const SQUARE = 0.2; // the cursor
const BASE = SQUARE / SIDE; // one cursor pixel
const Q_SIZE = 0.72; // the Q it becomes
const CELL = Q_SIZE / 7;
const PIXEL = CELL * 0.86;
// The Q grows up and to the right from the cursor's bottom-left corner
const ORIGIN = { x: 0.04, y: SQUARE - Q_SIZE + CELL * 0.5 };

const TARGETS = Array.from({ length: SIDE * SIDE }, (_, i) => {
  const ring = i < Q_RING.length;
  const [cx, cy] = ring ? Q_RING[i] : Q_CORE[(i - Q_RING.length) % Q_CORE.length];
  const col = i % SIDE;
  const row = Math.floor(i / SIDE);
  // move centre to centre, then scale the pixel up to the Q's cell size
  const from = { x: col * BASE + BASE / 2, y: row * BASE + BASE / 2 };
  const to = { x: ORIGIN.x + cx * CELL + PIXEL / 2, y: ORIGIN.y + cy * CELL + PIXEL / 2 };
  return { col, row, ring, dx: to.x - from.x, dy: to.y - from.y, order: cy * 7 + cx };
});

function Cursor({ shown }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      aria-hidden
      data-cursor
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onClick={() => setOpen((o) => !o)}
      className="relative mb-[0.08em] ml-[0.06em] inline-block size-[0.2em] cursor-pointer transition-opacity duration-500"
      style={{ opacity: shown ? 1 : 0, transitionDelay: shown && !open ? `${NAME.length * 70 + 300}ms` : "0ms" }}
    >
      {/* a generous invisible hit area around the small square */}
      <span className="absolute -inset-[0.12em]" />
      <span className={clsx("absolute inset-0", !open && "caret")}>
        {TARGETS.map((t, i) => (
          <span
            key={i}
            className="absolute block"
            style={{
              left: `${t.col * BASE}em`,
              top: `${t.row * BASE}em`,
              width: `${BASE}em`,
              height: `${BASE}em`,
              background: open && t.ring ? "#f4f4f5" : "var(--color-accent)",
              transform: open ? `translate(${t.dx}em, ${t.dy}em) scale(${PIXEL / BASE})` : "none",
              transition: open
                ? `transform 700ms cubic-bezier(0.16,1,0.3,1) ${t.order * 12}ms, background-color 400ms ease ${t.order * 12}ms`
                : `transform 520ms cubic-bezier(0.16,1,0.3,1) ${(48 - t.order) * 6}ms, background-color 300ms ease`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

export function Signature() {
  const [ref, shown] = useInView({ rootMargin: "0px 0px -15% 0px" });
  return (
    <div ref={ref} className="relative">
      <p
        aria-label="quereo"
        className="flex items-end font-mono leading-[0.8] font-bold tracking-[-0.07em] whitespace-nowrap select-none"
        style={{ fontSize: "min(20vw, 16.5rem)" }}
      >
        {NAME.split("").map((ch, i) => (
          <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.06em]">
            <span
              className="inline-block transition-transform duration-[1100ms] ease-[var(--ease-out)]"
              style={{ transform: shown ? "translateY(0)" : "translateY(110%)", transitionDelay: `${i * 70}ms` }}
            >
              {ch}
            </span>
          </span>
        ))}
        <Cursor shown={shown} />
      </p>
      <p
        className="mt-6 font-mono text-[11px] text-ink-3 transition-opacity duration-700 lg:absolute lg:right-0 lg:-bottom-9 lg:mt-0"
        style={{ opacity: shown ? 1 : 0, transitionDelay: `${NAME.length * 70 + 900}ms` }}
      >
        <span className="hidden sm:inline">// psst. hover the cursor.</span>
        <span className="sm:hidden">// psst. tap the cursor.</span>
      </p>
    </div>
  );
}
