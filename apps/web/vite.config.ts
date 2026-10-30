import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In production Caddy serves the SPA and proxies /api/* to the API with the prefix
// stripped (docs/architecture.md §8.1). The dev server does the same, so the SPA only
// ever talks to its own origin.
const apiOrigin = "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiOrigin,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
