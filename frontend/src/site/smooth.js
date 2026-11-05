import { useEffect } from "react";
import Lenis from "lenis";

// Smooth, inertial wheel scrolling for the marketing pages. Phones keep native
// scrolling (smoothing touch feels stuck), and so does reduced motion.
export function useSmoothScroll() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (reduced || touch) return undefined;
    const lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
    window.__lenis = lenis;
    let frame = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      delete window.__lenis;
    };
  }, []);
}

// Glide to a y position (or an element), through Lenis when it's running
export function scrollToTarget(target, offset = -64) {
  const lenis = window.__lenis;
  if (lenis) {
    lenis.scrollTo(target, { offset: typeof target === "number" ? 0 : offset, duration: 1.2 });
    return;
  }
  const y = typeof target === "number" ? target : target.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top: y, behavior: "smooth" });
}

// In-page links like "/#product": glide there instead of jumping
export function onHashLink(event, href) {
  const hash = href.split("#")[1];
  if (!hash || window.location.pathname !== "/" || event.metaKey || event.ctrlKey) return;
  const el = document.getElementById(hash);
  if (!el) return;
  event.preventDefault();
  scrollToTarget(el);
  history.replaceState(null, "", `#${hash}`);
}
