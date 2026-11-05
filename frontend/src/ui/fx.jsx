import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useInView } from "./motion";

// Effects in the style of the popular component galleries (spotlight cards,
// border beams, shimmer and decode text, animated lists), rebuilt on Quereo's
// tokens so they match everything else. All of them sit still under
// prefers-reduced-motion.

const still = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Card with a soft violet light that follows the pointer
export function Spotlight({ as: Tag = "div", className, children, ...props }) {
  const ref = useRef(null);
  const move = (event) => {
    const rect = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--x", `${event.clientX - rect.left}px`);
    ref.current.style.setProperty("--y", `${event.clientY - rect.top}px`);
  };
  return (
    <Tag ref={ref} onPointerMove={move} className={clsx("spotlight relative overflow-hidden", className)} {...props}>
      {children}
    </Tag>
  );
}

// A short streak of light that travels around the element's border
export function BorderBeam({ className, duration = 7 }) {
  return <span aria-hidden className={clsx("beam pointer-events-none absolute inset-0 rounded-[inherit]", className)} style={{ "--beam-duration": `${duration}s` }} />;
}

// Text with a light band sweeping across it
export function Shimmer({ children, className }) {
  return <span className={clsx("shimmer-text", className)}>{children}</span>;
}

// Mono text that resolves from random glyphs into the real string once visible
const GLYPHS = "▖▗▘▙▚▛▜▝▞▟░▒▓01#%&*+=<>/";
export function Decode({ text, className, speed = 28 }) {
  const [ref, shown] = useInView({ threshold: 0.5 });
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (!shown || still()) {
      setOut(text);
      return undefined;
    }
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const settled = Math.floor(frame / 2);
      setOut(text.split("").map((ch, i) => (i < settled || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""));
      if (settled >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [shown, text, speed]);
  return <span ref={ref} className={clsx("font-mono", className)} aria-label={text}>{out}</span>;
}

// Items appear one after another, newest sliding in from the top
export function AnimatedList({ items, render, interval = 900, className, loop = true }) {
  const [ref, shown] = useInView({ threshold: 0.3 });
  const [count, setCount] = useState(still() ? items.length : 0);
  useEffect(() => {
    if (!shown || still()) return undefined;
    const id = setInterval(() => {
      // Hold the full list for a few beats before starting over
      setCount((c) => (c >= items.length + 4 ? (loop ? 1 : c) : c + 1));
    }, interval);
    return () => clearInterval(id);
  }, [shown, items.length, interval, loop]);
  const visible = items.slice(0, Math.min(items.length, Math.max(count, still() ? items.length : 0))).reverse();
  return (
    <ul ref={ref} className={clsx("flex flex-col gap-2", className)}>
      {visible.map((item) => (
        <li key={item.id} className="pop-in">{render(item)}</li>
      ))}
    </ul>
  );
}
