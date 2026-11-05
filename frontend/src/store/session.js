import { create } from "zustand";
import { del, get, post } from "../lib/api";

// Who is signed in, their connections, and which connection is open.
// The open connection is remembered across reloads.
const CURRENT_KEY = "quereo:connection";

const remembered = () => {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
};

export const useSession = create((set, getState) => ({
  status: "loading", // loading | guest | ready
  user: null,
  ai: { enabled: false, model: null },
  types: [],
  connections: [],
  currentId: remembered(),

  load: async () => {
    try {
      const user = await get("/users/me");
      set({ user });
      await getState().refresh();
      set({ status: "ready" });
    } catch {
      set({ user: null, status: "guest" });
    }
  },

  refresh: async () => {
    const [types, connections, ai] = await Promise.all([get("/connections/types"), get("/connections"), get("/ai/status")]);
    const { currentId } = getState();
    const keep = connections.some((c) => c._id === currentId);
    set({ types, connections, ai, currentId: keep ? currentId : connections[0]?._id ?? null });
  },

  login: async (email, password) => {
    const { user } = await post("/users/login", { email, password });
    set({ user });
    await getState().refresh();
    set({ status: "ready" });
  },

  register: async (fullName, email, password) => {
    await post("/users/register", { fullName, email, password });
    await getState().login(email, password);
  },

  // Signs in with a Google access token; resolves to true for a new account
  loginWithGoogle: async (accessToken) => {
    const { user, created } = await post("/users/google", { accessToken });
    set({ user });
    await getState().refresh();
    set({ status: "ready" });
    return created;
  },

  logout: async () => {
    await post("/users/logout").catch(() => {});
    set({ user: null, status: "guest", connections: [], currentId: null });
  },

  // Deletes the account for good; `confirm` is the user's email typed back
  deleteAccount: async (confirm) => {
    const counts = await del("/users/me", { confirm });
    try {
      localStorage.removeItem(CURRENT_KEY);
    } catch {
      // nothing remembered
    }
    return counts;
  },

  // Clears local state once a gate has covered the screen
  clear: () => set({ user: null, status: "guest", connections: [], currentId: null }),

  select: (id) => {
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {
      // private mode: just don't remember it
    }
    set({ currentId: id });
  },
}));

export const useCurrentConnection = () =>
  useSession((state) => state.connections.find((c) => c._id === state.currentId) ?? null);
