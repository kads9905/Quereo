import { useEffect, useRef } from "react";
import clsx from "clsx";

// Small animated pixel-art scenes for the product story. Drawn on a canvas in
// square cells with a 1px gap; each scene is a function of time. Pauses off
// screen and draws a single frame under prefers-reduced-motion.

const CELL = 5;
const V = ["#2a2550", "#3a3270", "#5b4bd6", "#7a67ff", "#a99dff"];
const WHITE = "#f4f4f5";
const RED = "#f87171";
const GREEN = "#4ade80";

const hash = (x, y, z = 0) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + z * 2147483647, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

// Dithered "ground" the objects sit on, denser toward the bottom; a few cells twinkle
function ground(put, cols, rows, time) {
  const depth = Math.min(16, Math.floor(rows * 0.3));
  const tick = Math.floor(time * 3);
  for (let y = rows - depth; y < rows; y++) {
    const d = (y - (rows - depth)) / depth;
    for (let x = 0; x < cols; x++) {
      const h = hash(x, y);
      if (h < d * d * 0.7 && hash(x, y, tick) > 0.04) put(x, y, h < 0.08 ? V[3] : h < 0.25 ? V[2] : V[1]);
    }
  }
}

const SCENES = {
  // A lens sweeping across rows of a table; rows under it are read in full
  lens(put, cols, rows, time, cx, cy) {
    const rowYs = [-8, -5, -2, 1, 4, 7].map((d) => cy + d);
    const lx = Math.round(cx + Math.sin(time * 0.9) * Math.min(28, cols * 0.22));
    const ly = cy - 1;
    const R = 9;
    for (const [r, y] of rowYs.entries()) {
      for (let x = cx - 40; x <= cx + 40; x++) {
        if ((x + r * 3) % 7 < 5) {
          const inside = Math.hypot(x - lx, y - ly) < R - 1.2;
          put(x, y, inside ? (r === 3 ? RED : WHITE) : V[1]);
        }
      }
    }
    for (let y = ly - R - 1; y <= ly + R + 1; y++) {
      for (let x = lx - R - 1; x <= lx + R + 1; x++) {
        const d = Math.hypot(x - lx, y - ly);
        if (d >= R - 1 && d <= R + 0.6) put(x, y, d > R - 0.2 ? V[4] : WHITE);
      }
    }
    for (let k = 0; k < 8; k++) {
      const hx = Math.round(lx + R * 0.72 + k * 0.85);
      const hy = Math.round(ly + R * 0.72 + k * 0.85);
      put(hx, hy, V[3]);
      put(hx + 1, hy, V[3]);
      put(hx, hy + 1, V[2]);
    }
  },

  // A lightning bolt that pulses, throwing sparks
  bolt(put, cols, rows, time, cx, cy) {
    const pts = [[2, -13], [-6, 1], [-0.5, 1], [-4, 13], [7, -2], [1.5, -2], [5, -13]];
    const s = 1.25 + Math.sin(time * 3) * 0.04;
    const poly = pts.map(([x, y]) => [cx + x * s, cy + y * s]);
    const inside = (px, py) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (let y = cy - 18; y <= cy + 18; y++) {
      for (let x = cx - 12; x <= cx + 12; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        const glint = Math.abs(y - cy + ((time * 22) % 40) - 20) < 2;
        put(x, y, edge || glint ? WHITE : (x + y) % 2 ? V[3] : V[2]);
      }
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + i;
      const r = 14 + ((time * 16 + i * 5) % 18);
      put(Math.round(cx + Math.cos(a) * r * 1.5), Math.round(cy + Math.sin(a) * r * 0.8), r > 26 ? V[1] : r > 20 ? V[2] : V[4]);
    }
  },

  // A heartbeat line drawn left to right; every third beat spikes red
  pulse(put, cols, rows, time, cx, cy) {
    const span = Math.min(110, cols - 8);
    const left = Math.round(cx - span / 2);
    const head = Math.floor((time * 28) % (span + 30));
    const shape = { 18: -2, 19: -10, 20: 7, 21: -3 };
    for (let i = 0; i < span; i++) {
      const beat = Math.floor(i / 40);
      const d = i % 40;
      const y = cy + (shape[d] ?? 0);
      const age = head - i;
      if (age < 0) {
        put(left + i, cy, V[0]);
        continue;
      }
      const color = beat % 3 === 2 && shape[d] ? RED : age < 3 ? WHITE : age < 30 ? V[3] : V[2];
      const from = shape[d - 1] ?? 0;
      const to = shape[d] ?? 0;
      for (let k = Math.min(from, to); k <= Math.max(from, to); k++) put(left + i, cy + k, color);
      put(left + i, y, color);
    }
    // the bell
    const bx = left + span - 6;
    const by = cy - 14;
    for (let y = 0; y < 7; y++) for (let x = -y / 2 - 1; x <= y / 2 + 1; x++) put(Math.round(bx + x), by + y, y === 0 ? WHITE : V[3]);
    if (Math.floor(time * 2) % 2) put(bx + 5, by - 1, RED);
  },

  // Two databases with a diff travelling between them
  diff(put, cols, rows, time, cx, cy) {
    const cylinder = (ox, flicker) => {
      const rx = 10;
      for (let y = cy - 11; y <= cy + 9; y++) {
        for (let x = ox - rx; x <= ox + rx; x++) {
          const top = Math.hypot((x - ox) / rx, (y - (cy - 9)) / 2.6) <= 1;
          const body = y >= cy - 9 && y <= cy + 7;
          const bottom = Math.hypot((x - ox) / rx, (y - (cy + 7)) / 2.6) <= 1;
          if (!(top || body || bottom)) continue;
          const rim = Math.abs(Math.hypot((x - ox) / rx, (y - (cy - 9)) / 2.6) - 1) < 0.22 || Math.abs(x - ox) >= rx - 0.5;
          const band = [cy - 3, cy + 3].includes(y);
          let color = rim ? WHITE : band ? V[4] : (x + y) % 2 ? V[2] : V[1];
          if (flicker && band && (x - ox + Math.floor(time * 4)) % 5 === 0) color = (x + y) % 2 ? RED : GREEN;
          put(x, y, color);
        }
      }
    };
    cylinder(cx - 24, false);
    cylinder(cx + 24, true);
    const travel = Math.floor((time * 14) % 22);
    for (let x = cx - 10; x <= cx + 10; x++) put(x, cy - 1, x - (cx - 10) <= travel ? V[4] : V[1]);
    put(cx + 9, cy - 2, V[4]);
    put(cx + 9, cy, V[4]);
    put(cx + 8, cy - 3, V[3]);
    put(cx + 8, cy + 1, V[3]);
  },

  // A speech bubble that types itself
  type(put, cols, rows, time, cx, cy) {
    const w = 28;
    const top = cy - 14;
    const bottom = cy + 8;
    for (let y = top; y <= bottom; y++) {
      for (let x = cx - w; x <= cx + w; x++) {
        const edge = y === top || y === bottom || x === cx - w || x === cx + w;
        put(x, y, edge ? WHITE : "#121216");
      }
    }
    for (let k = 0; k < 5; k++) for (let j = 0; j <= 4 - k; j++) put(cx - w + 6 + j, bottom + 1 + k, k === 0 ? "#121216" : WHITE);
    const lines = [40, 30, 46, 22];
    const typed = Math.floor((time * 22) % 190);
    let left = typed;
    lines.forEach((len, i) => {
      const y = top + 4 + i * 4;
      const shown = Math.max(0, Math.min(len, left));
      left -= len;
      for (let x = 0; x < shown; x++) if ((x + i) % 9 !== 8) put(cx - w + 5 + x, y, i === 0 ? WHITE : V[3]);
      if (shown > 0 && shown < len && Math.floor(time * 4) % 2) put(cx - w + 6 + shown, y, V[4]);
    });
  },
};

export function PixelScene({ scene, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    const start = performance.now();

    const draw = (now) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0b0c";
      ctx.fillRect(0, 0, w, h);
      const cols = Math.floor(w / CELL);
      const rows = Math.floor(h / CELL);
      const put = (x, y, color) => {
        if (x < 0 || y < 0 || x >= cols || y >= rows) return;
        ctx.fillStyle = color;
        ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
      };
      const time = (now - start) / 1000;
      ground(put, cols, rows, time);
      SCENES[scene](put, cols, rows, time, Math.round(cols / 2), Math.round(rows * 0.42));
      if (visible && !still) frame = requestAnimationFrame(draw);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(frame);
      if (visible) frame = requestAnimationFrame(draw);
    });
    observer.observe(canvas);
    frame = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scene]);
  return <canvas ref={ref} aria-hidden className={clsx("block h-full w-full", className)} />;
}
