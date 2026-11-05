import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

// ── Buttons: square corners. Primary is ink (white on the dark site); secondary has a dotted border.
const BUTTON = {
  primary: "bg-ink text-bg hover:bg-accent hover:text-white",
  secondary: "border border-line-2 bg-bg/80 text-ink backdrop-blur-sm hover:border-ink-3 hover:bg-bg",
  ghost: "text-ink-2 hover:text-ink hover:bg-fill",
  danger: "border border-slow/30 bg-transparent text-slow hover:bg-slow-soft",
};
const BUTTON_SIZE = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[15px]" };

const Arrow = () => (
  <svg viewBox="0 0 12 12" className="nudge size-3" fill="none" aria-hidden>
    <path d="M2 6h7.5M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Button = forwardRef(function Button(
  { variant = "primary", size = "md", as: Tag = "button", arrow = false, className, children, ...props },
  ref
) {
  return (
    <Tag
      ref={ref}
      className={clsx(
        "press group inline-flex shrink-0 items-center justify-center gap-2 rounded-sm font-medium tracking-[-0.01em] whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40",
        BUTTON[variant],
        BUTTON_SIZE[size],
        className
      )}
      {...props}
    >
      {children}
      {arrow && <Arrow />}
    </Tag>
  );
});

// ── Keyboard key
export function Kbd({ children, className }) {
  return <kbd className={clsx("inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-2 bg-fill px-1 font-mono text-[10px] text-ink-2", className)}>{children}</kbd>;
}

// ── Small grey label chip
export function Chip({ children, className }) {
  return <span className={clsx("inline-flex items-center gap-1.5 rounded-xs border border-line bg-fill/60 px-2 py-0.5 text-xs text-ink-2", className)}>{children}</span>;
}

// ── Result badge: PASS / WARN / SLOW
const VERDICT = {
  PASS: "bg-pass-soft text-pass",
  WARN: "bg-warn-soft text-warn",
  SLOW: "bg-slow-soft text-slow",
};
export function Verdict({ value, className }) {
  return <span className={clsx("caps inline-flex rounded-xs px-1.5 py-0.5 font-medium", VERDICT[value] ?? "bg-fill text-ink-2", className)}>{value}</span>;
}

// ── Status dot (live adds a soft pulsing ring)
const DOT = { ok: "bg-pass text-pass", warn: "bg-warn text-warn", bad: "bg-slow text-slow", idle: "bg-ink-3 text-ink-3", accent: "bg-accent text-accent" };
export function Dot({ tone = "idle", live = false, className }) {
  return <span aria-hidden className={clsx("inline-block size-1.5 shrink-0 rounded-full", DOT[tone], live && "live", className)} />;
}

// ── Card with an optional header row
export function Card({ title, meta, action, icon, className, bodyClassName, children }) {
  return (
    <section className={clsx("rounded-md border border-line bg-subtle/40 transition-colors duration-200 hover:border-line-2/70", className)}>
      {(title || action) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="grid size-6 shrink-0 place-items-center rounded-xs border border-line bg-fill text-ink-2">{icon}</span>}
            {title && <h2 className="truncate text-[13px] font-medium">{title}</h2>}
            {meta && <span className="hidden truncate text-xs text-ink-3 sm:inline">{meta}</span>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName ?? "p-4"}>{children}</div>
    </section>
  );
}

// ── Segmented tabs with an indicator that slides to the active item
export function Tabs({ items, value, onChange, className, size = "sm" }) {
  const wrap = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector(`[data-value="${CSS.escape(String(value))}"]`);
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, items.length]);
  return (
    <div ref={wrap} role="tablist" className={clsx("relative inline-flex items-center rounded-xs border border-line bg-bg p-0.5", className)}>
      {box && <span aria-hidden className="absolute top-0.5 bottom-0.5 left-0 rounded-[1px] bg-fill shadow-[0_0_0_1px_var(--color-line-2)] transition-[transform,width] duration-300 ease-[var(--ease-out)]" style={{ width: box.width, transform: `translateX(${box.left}px)` }} />}
      {items.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          data-value={key}
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={clsx("relative z-10 rounded-[1px] transition-colors duration-150", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm", value === key ? "text-ink" : "text-ink-3 hover:text-ink-2")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Form fields
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={clsx("flex flex-col gap-1.5", className)}>
      <span className="caps text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-ink-3">{hint}</span>}
      {error && <span className="text-xs text-slow">{error}</span>}
    </label>
  );
}

const control = "w-full rounded-xs border border-line-2 bg-bg px-3 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)] focus:outline-none";

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={clsx(control, "h-10", className)} {...props} />;
});

export function Select({ className, children, ...props }) {
  return (
    <select className={clsx(control, "h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22><path d=%22M3 4.5 6 7.5 9 4.5%22 fill=%22none%22 stroke=%22%238c8c8c%22 stroke-width=%221.4%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={clsx(control, "py-2.5 font-mono", className)} {...props} />;
});

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-2.5 text-sm text-ink", className)}>
      <input type="checkbox" className="size-4 rounded-xs border-line-2 accent-[var(--color-accent)]" {...props} />
      {label}
    </label>
  );
}

// ── Loading: shimmering placeholder rows
export function Skeleton({ className }) {
  return <span aria-hidden className={clsx("skeleton block", className)} />;
}

export function Loading({ label = "Loading…", className, rows = 3 }) {
  return (
    <div role="status" aria-label={label} className={clsx("flex flex-col gap-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={clsx("h-3.5", ["w-3/4", "w-full", "w-1/2", "w-2/3"][i % 4])} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({ title, children, action, icon }) {
  return (
    <div className="swap grid-bg relative flex flex-col items-start gap-2 overflow-hidden rounded-md border border-dashed border-line-2 px-6 py-12 sm:px-10">
      {icon && <span className="mb-2 grid size-10 place-items-center rounded-xs border border-line-2 bg-bg text-accent">{icon}</span>}
      <p className="heading text-lg">{title}</p>
      {children && <p className="max-w-[56ch] text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <p role="alert" className="swap rounded-xs border border-slow/25 bg-slow-soft px-3 py-2 text-sm text-slow">{children}</p>;
}

// ── Numbered step marker: ink box with a mono number
export function Step({ n, className }) {
  return <span className={clsx("caps inline-flex h-6 min-w-8 items-center justify-center rounded-xs bg-ink px-2 text-bg", className)}>{String(n).padStart(2, "0")}</span>;
}

// ── Checklist row in a soft grey box
export function CheckRow({ children }) {
  return (
    <li className="flex items-center gap-3 rounded-xs bg-fill px-3.5 py-2.5 text-sm text-ink">
      <svg viewBox="0 0 12 12" className="size-3 shrink-0" fill="none" aria-hidden>
        <path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </li>
  );
}

// ── Native <dialog> modal: focus trap, Escape and backdrop come for free; it pops in via CSS
export function Dialog({ open, onClose, title, children, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className={clsx("m-auto w-[min(540px,calc(100vw-32px))] rounded-md border border-line-2 bg-bg p-0 text-ink shadow-[0_32px_80px_-16px_rgb(0_0_0/0.7)] backdrop:bg-black/65 backdrop:backdrop-blur-[3px]", className)}
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="heading text-md">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="press grid size-7 place-items-center rounded-xs text-ink-3 hover:bg-fill hover:text-ink">✕</button>
      </header>
      <div className="p-5">{open && children}</div>
    </dialog>
  );
}

// ── Logo: a pixel "Q". A ring of square pixels with its tail stepping out at
// the bottom right, and a solid violet block at its centre: the row the query
// found. Pixels because the whole site speaks in them; the q takes the text colour.
export const Q_PIXELS = [[1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [0, 2], [0, 3], [0, 4], [5, 1], [5, 2], [5, 3], [5, 4], [1, 5], [2, 5], [3, 5], [4, 5], [4, 4], [5, 5], [6, 6]];
export const Q_CORE = [[2, 2], [3, 2], [2, 3], [3, 3]];
export function LogoMark({ className = "size-6" }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden shapeRendering="crispEdges">
      {Q_PIXELS.map(([x, y]) => <rect key={`${x}-${y}`} x={x * 4} y={y * 4} width="3.4" height="3.4" fill="currentColor" />)}
      {Q_CORE.map(([x, y]) => <rect key={`c${x}-${y}`} x={x * 4} y={y * 4} width="4" height="4" fill="var(--color-accent)" />)}
    </svg>
  );
}

// ── Wordmark: mono "quereo" closed by the violet square
export function Logo({ className }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="flex items-baseline font-mono text-[18px] leading-none font-semibold tracking-[-0.06em]">
        quereo<span aria-hidden className="ml-[2px] inline-block size-[5px] bg-accent" />
      </span>
    </span>
  );
}

// ── Violet pixel mosaic, the backdrop for product UI in marketing sections.
// With `live`, a few tiles slowly shift shade.
const SHADES = ["#5b45ff", "#6a56ff", "#7b69ff", "#8f80ff", "#4e3be6", "#a497ff"];
export function PixelPanel({ className, children, seed = 3, live = false }) {
  const cols = 16;
  const rows = 12;
  const [tiles, setTiles] = useState(() => {
    let s = seed;
    const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: cols * rows }, () => SHADES[Math.floor(random() * SHADES.length)]);
  });
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setInterval(() => {
      setTiles((prev) => {
        const next = [...prev];
        for (let k = 0; k < 6; k++) next[Math.floor(Math.random() * next.length)] = SHADES[Math.floor(Math.random() * SHADES.length)];
        return next;
      });
    }, 900);
    return () => clearInterval(id);
  }, [live]);
  return (
    <div className={clsx("relative overflow-hidden rounded-md", className)}>
      <svg className="absolute inset-0 size-full" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden shapeRendering="crispEdges">
        {tiles.map((fill, i) => (
          <rect key={i} x={i % cols} y={Math.floor(i / cols)} width="1.02" height="1.02" fill={fill} style={{ transition: "fill 1.2s ease" }} />
        ))}
      </svg>
      <div className="relative h-full">{children}</div>
    </div>
  );
}
