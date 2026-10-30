# Meal Planner

A self-hosted meal planner for a homelab: plan a week of meals, generate a
consolidated shopping list, and import recipes from a URL or a photo.

Built as a practice project for the TypeScript ecosystem end to end — typed API
through typed client, AI features built on the Claude API, deployed with Docker
Compose on a local network.

## Status

Pre-implementation. The design is in **[docs/architecture.md](docs/architecture.md)**.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 7, Node 26, pnpm workspaces, Turborepo |
| Backend | Hono + `@hono/zod-openapi`, Drizzle ORM (`sqlite-core`), SQLite |
| Frontend | Vite, React 19, TanStack Router/Query/Form, Tailwind 4 |
| AI | Claude (`@anthropic-ai/sdk`) — structured outputs, tool use, streaming; Effect inside `packages/ai` |
| Deployment | Docker Compose behind Caddy on a Synology NAS (Podman for local dev), remote access over the router's VPN |

## Getting started

Toolchain versions are pinned in `mise.toml` (Node 26, pnpm 12).

```sh
mise install          # or install Node 26 and pnpm 12 yourself
pnpm install
pnpm turbo typecheck lint

cp .env.example .env  # local config; see the comments in it
pnpm db:migrate       # create data/meal-planner.db
pnpm dev              # API on http://127.0.0.1:3000 (/health, /ready, /openapi.json)
```

| Command | What it does |
|---|---|
| `pnpm build` / `typecheck` / `test` | Run that Turborepo task across every workspace package |
| `pnpm lint` | Biome lint + format check over the whole repo |
| `pnpm format` | Apply Biome fixes and formatting |
| `pnpm db:generate` | Generate a SQL migration from `packages/db/src/schema.ts` — read it before committing |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_PATH` (default `data/meal-planner.db`). Never runs on API boot |

### Containers

The deployment runs from `docker/compose.yaml`: a one-shot `migrate`, the Node API,
and Caddy serving the SPA with `/api/*` proxied. To run it locally:

```sh
podman compose -f docker/compose.yaml -f docker/compose.podman.yaml up --build
# with Docker: docker compose -f docker/compose.yaml up --build
curl -k https://localhost:8443/api/health
```

Caddy uses its internal CA, so browsers warn until its root (in the `caddy-data` volume,
`pki/authorities/local/root.crt`) is trusted. Settings are in `docker/.env.example`.
Backups are daily SQLite snapshots copied off the NAS; losing changes since the
last successful backup is acceptable for this household app.

The Podman override maps both database-writing services to your host user. Existing
development volumes created with a different mapping need an explicit ownership
transition before they can be reused.

pnpm refuses dependency versions published less than 7 days ago
(`minimumReleaseAge` in `pnpm-workspace.yaml`).

## Layout

```
apps/api        Hono service
apps/web        React SPA (PWA)
packages/contracts   Zod schemas — the single source of truth for types
packages/core        Pure domain logic (aggregation, unit conversion)
packages/db          Drizzle schema + migrations (SQLite), tenant-scoped repositories
packages/ai          Claude capabilities: extract, chat, plan (Effect; exports Promises)
```

Dependencies point one way: `contracts` ← `core` ← `db`/`ai` ← `api`, and `web` may use
`contracts`, `core` and the API's `AppType`. `pnpm lint` fails on any import that breaks
this (Biome `noRestrictedImports` overrides in `biome.json`) or on any package a
workspace doesn't declare in its own `package.json`.

See [docs/architecture.md](docs/architecture.md) for the reasoning behind each
choice, the build order, and the open questions.

## License

[AGPL-3.0](LICENSE). If you run a modified version for other people over a
network, you must offer them its source code.
