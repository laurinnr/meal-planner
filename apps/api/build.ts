import { cp, rm } from "node:fs/promises";
import { build } from "esbuild";

// Bundles the API for the container image. Node won't strip types from .ts files under
// node_modules, which is where `pnpm deploy` puts the workspace packages, so those are
// compiled in. Third-party packages stay external and load from the pruned
// node_modules: better-sqlite3 has to, being native, and bundling the rest buys nothing.
await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/main.ts", "src/migrate.ts"],
  outdir: "dist/app",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  plugins: [
    {
      name: "external-third-party",
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, ({ path }) =>
          path.startsWith("@meal-planner/") ? undefined : { path, external: true },
        );
      },
    },
  ],
  logLevel: "info",
});
// The db package resolves its migrations as ../migrations from its own module, which
// after bundling is dist/app/.
await cp("../../packages/db/migrations", "dist/migrations", { recursive: true });
