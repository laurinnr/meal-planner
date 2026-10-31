# AGENTS.md

Guidance for coding agents working in this repo. The human-facing overview is
[README.md](README.md); the design and its reasoning are in
[docs/architecture.md](docs/architecture.md). Read the relevant section there before
making a structural change. Don't copy it here.

## What this is

A self-hosted meal planner: a Hono API (`apps/api`) and a React SPA (`apps/web`) in a
pnpm + Turborepo monorepo, backed by SQLite through Drizzle. It is early (phase 0 of
the build order in architecture §9), so most packages are still stubs. Build what the
current phase needs, not what later phases will.

## Commands

Toolchain is pinned in `mise.toml` (Node 26, pnpm 12). Run these from the repo root:

```sh
pnpm install
pnpm lint             # Biome lint + format check (CI runs `pnpm biome ci .`)
pnpm format           # apply Biome fixes
pnpm typecheck        # tsc --noEmit in every package, via Turborepo
pnpm test             # Vitest unit and SQLite integration tests, via Turborepo
pnpm build            # API bundle and SPA production build
pnpm db:generate      # SQL migration from packages/db/src/schema.ts
pnpm db:migrate       # apply migrations to DATABASE_PATH
pnpm dev              # API on http://127.0.0.1:3000
```

Before calling a change done, run `pnpm lint` and `pnpm typecheck`. CI runs
both, plus `pnpm test`.

## How the code is written

- **Node runs TypeScript directly in development** with type stripping, and workspace
  packages export `./src/index.ts`. The container build bundles the API and its
  operational entry points with esbuild; Vite builds the SPA. `erasableSyntaxOnly`
  is on: no `enum`, no `namespace`, no constructor parameter properties.
- **Relative imports carry the `.ts` extension** (`./logger.ts`). Type-only imports
  use `import type` (`verbatimModuleSyntax`).
- `strict` and `noUncheckedIndexedAccess` are on. Handle the `undefined`, don't
  reach for a non-null assertion.
- Biome formats the code: 2 spaces, double quotes, 100-column lines. Don't hand-format.
  Let `pnpm format` do it.
- Config comes from `apps/api/src/env.ts`, which validates it with Zod at boot. New
  env vars go there and into `.env.example` with a comment.

## Architecture rules that are easy to break

- **Dependencies point one way:** `contracts` ← `core` ← `db`/`ai` ← `api`. `web` may
  use `contracts`, `core`, and only the `AppType` type from `@meal-planner/api`.
  `pnpm lint` enforces this, and fails on any package a workspace uses without
  declaring it in its own `package.json`.
- **`packages/core` stays pure.** It does no I/O, so it can be unit-tested fast.
- **Zod schemas in `packages/contracts` are the single source of truth** for API
  types and for Claude structured outputs. DB row types are not API types. Keep
  the DTOs explicit and separate from the Drizzle schema (§4).
- **Tenancy is structural (§4.1).** Every tenant-scoped table has `household_id`, a
  composite `(household_id, id)` primary key, and composite foreign keys. The raw
  Drizzle handle never leaves `packages/db`. Queries go through
  `forHousehold(id)`. `household_id` never comes from a request body, a query
  parameter, or an AI tool's input schema.
- **Migrations:** after `pnpm db:generate`, read the generated SQL before committing.
  drizzle-kit's table-recreate migrations drop and rebuild foreign keys.
  Migrations never run on API boot.
- **Effect is confined to `packages/ai`** (§6.5). That package exports
  Promise-returning functions, and everything else stays plain async/await.
- **No write transaction stays open across an `await`** on a network call (§6.4).
- **No AI in the shopping list's critical path.** Every AI flow needs a manual
  equivalent (§6.4).

## Dependencies

- pnpm refuses versions published less than 7 days ago (`minimumReleaseAge`). If an
  install fails on that, pick an older version. Don't loosen the setting.
- Add a dependency to the workspace that uses it, not to the root.
- GitHub Actions are pinned to commit SHAs with a version comment. Keep it that way.

## Commits and PRs

Conventional Commits, one reviewable change per branch, stacked PRs via `gh stack`,
rebase-merged. The full workflow is in
[.claude/skills/commit/SKILL.md](.claude/skills/commit/SKILL.md). The key points:

- Every commit is a valid Conventional Commit that builds and passes on its own.
  Scopes: `api`, `web`, `contracts`, `core`, `db`, `ai`, `infra`, `deps`.
- Stage explicit paths. Never use `git add -A`.
- Fold review fixes into the commit they belong to. Don't add "fix review" commits.
- Ask before pushing or opening PRs.
