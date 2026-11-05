import { create } from "zustand";

// The full-screen gate shown between signing in, signing out or deleting the
// account and the page that follows. run() keeps it up for at least the
// gate's length while `work` (navigation, API calls) happens behind it.
export const GATE_MS = { open: 2900, close: 2300, drop: 3400 };
const LEAVE_MS = { open: 650, close: 650, drop: 650 };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const useGate = create((set) => ({
  gate: null, // { kind: open | close | drop, ms, name, email, isNew, connections, counts }
  leaving: false,

  run: async (kind, data, work) => {
    const ms = reduced() ? 700 : GATE_MS[kind];
    set({ gate: { kind, ms, ...data }, leaving: false });
    try {
      await Promise.all([wait(ms), work?.()]);
    } finally {
      set({ leaving: true });
      await wait(LEAVE_MS[kind]);
      set({ gate: null, leaving: false });
    }
  },
}));
