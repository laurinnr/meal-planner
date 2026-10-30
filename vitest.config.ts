import { defineConfig } from "vitest/config";

// Lets `vitest` at the root (and editor integrations) see every package's tests.
// `pnpm test` runs each package's own `vitest run` through Turborepo instead.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
