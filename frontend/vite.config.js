import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API runs on :8000. Proxying keeps the browser on one origin,
    // so the login cookie just works in development.
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
