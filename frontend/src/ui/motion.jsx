import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// True once the element has scrolled into view (and stays true)
export function useInView({ threshold = 0, rootMargin = "0px 0px -12% 0px" } = {}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      setShown(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShown(true);
        observer.disconnect();
      }
    }, { threshold, rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);
  return [ref, shown];
}

// Fades, lifts and un-blurs its content when it scrolls into view.
// `i` staggers siblings by 70 ms each.
export function Reveal({ as: Tag = "div", i = 0, className, style, children, ...props }) {
  const [ref, shown] = useInView();
  return (
    <Tag ref={ref} data-reveal="" data-shown={shown} className={className} style={{ "--i": i, ...style }} {...props}>
      {children}
    </Tag>
  );
}

// Headline whose words rise out of a mask one after another.
// Pass lines as an array to force line breaks; `dim` greys out the given line indexes.
// `gap` sets the space between words (e.g. "0.3em"); mono spaces are a full
// character wide, which reads as holes in big display lines.
export function Words({ as: Tag = "h2", lines, dim = [], className, start = 0, gap }) {
  const [ref, shown] = useInView();
  let index = start;
  return (
    <Tag ref={ref} data-shown={shown} className={clsx("words", className)}>
      {lines.map((line, l) => {
        const words = line.split(" ");
        return (
          <span key={l} className={clsx("block", dim.includes(l) && "text-ink-3")}>
            {words.map((word, w) => (
              <span key={w} className="w" style={gap && w < words.length - 1 ? { marginRight: gap } : undefined}>
                <span style={{ "--i": index++ }}>{word}</span>
                {!gap && w < words.length - 1 && " "}
              </span>
            ))}
          </span>
        );
      })}
    </Tag>
  );
}

// Counts from 0 to `value` once visible. `format` renders the number.
export function CountUp({ value, duration = 1200, format = (n) => Math.round(n).toLocaleString("en-US"), className }) {
  const [ref, shown] = useInView({ threshold: 0.4 });
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!shown || value == null) return undefined;
    if (reducedMotion()) {
      setCurrent(value);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setCurrent(value * (1 - Math.pow(1 - t, 4)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown, value, duration]);
  return <span ref={ref} className={clsx("tabular", className)}>{value == null ? "–" : format(current)}</span>;
}

// Tiny bar chart; bars grow in once visible. `highlight` indexes get the accent.
export function MicroBars({ values, highlight = [], className, tone = "bg-ink-3" }) {
  const [ref, shown] = useInView({ threshold: 0.3 });
  const max = Math.max(...values, 1);
  return (
    <div ref={ref} className={clsx("flex h-8 items-end gap-[3px]", className)} aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={clsx("w-[3px] flex-none rounded-[1px]", shown && "grow-y", highlight.includes(i) ? "bg-accent" : tone)}
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, "--i": i, transform: shown ? undefined : "scaleY(0)" }}
        />
      ))}
    </div>
  );
}

// Section label: "■ LABEL ────", the text decoding in from noise when it arrives
const NOISE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>";
export function Eyebrow({ text, className }) {
  const [ref, shown] = useInView();
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (!shown || reducedMotion()) {
      setOut(text);
      return undefined;
    }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const elapsed = now - t0;
      let settled = true;
      const next = text.split("").map((ch, i) => {
        if (ch === " " || elapsed > 120 + i * 32) return ch;
        settled = false;
        return NOISE[(Math.random() * NOISE.length) | 0];
      }).join("");
      setOut(next);
      if (!settled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown, text]);
  return (
    <p ref={ref} className={clsx("eyebrow", className)} aria-label={text}>
      <span aria-hidden style={{ visibility: shown ? "visible" : "hidden" }}>{out}</span>
      <span aria-hidden className="ml-2 h-px w-24 bg-current opacity-25" />
    </p>
  );
}

// Margin note: a review comment beside the page, mono italic with a dashed leader
export function Note({ children, className }) {
  return (
    <Reveal i={4} className={clsx("flex max-w-[40ch] items-start gap-2.5 font-mono text-xs leading-[1.6] text-ink-3 italic", className)}>
      <span aria-hidden className="mt-[0.75em] w-6 shrink-0 border-t border-dashed border-accent/70" />
      <span><span className="text-accent-ink not-italic">// </span>{children}</span>
    </Reveal>
  );
}
