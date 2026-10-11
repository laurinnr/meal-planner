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
| Language | TypeScript 7, Node 24, pnpm workspaces, Turborepo |
| Backend | Hono + `@hono/zod-openapi`, Drizzle ORM (`sqlite-core`), SQLite |
| Frontend | Vite, React 19, TanStack Router/Query/Form, Tailwind 4 |
| AI | Claude (`@anthropic-ai/sdk`) — structured outputs, tool use, streaming; Effect inside `packages/ai` |
| Deployment | Docker Compose behind Caddy (runs under Podman too), over Tailscale |

## Layout

```
apps/api        Hono service
apps/web        React SPA (PWA)
packages/contracts   Zod schemas — the single source of truth for types
packages/core        Pure domain logic (aggregation, unit conversion)
packages/db          Drizzle schema + migrations (SQLite), tenant-scoped repositories
packages/ai          Claude capabilities: extract, chat, plan (Effect; exports Promises)
```

See [docs/architecture.md](docs/architecture.md) for the reasoning behind each
choice, the build order, and the open questions.

## License

[AGPL-3.0](LICENSE). If you run a modified version for other people over a
network, you must offer them its source code.
