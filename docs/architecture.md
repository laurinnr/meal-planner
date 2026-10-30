# Meal Planner — Architecture & Technology Plan

A fullstack TypeScript application for planning meals, run self-hosted on a homelab
local network. This document is the design brief: what we're building, what we're
building it with, and why.

**Status:** draft v1 — pre-implementation
**Last reviewed:** 2026-10-11

---

## 1. Goals

This project exists to practise four things, in roughly this order of emphasis:

1. **End-to-end type safety** — one schema definition flowing from the database
   through the API to the React client *and* into the LLM's structured output.
   No `any` at a boundary, no hand-kept duplicate type definitions.
2. **Rich AI features** — not a chatbot bolted on the side. Structured extraction,
   tool-calling agents, and token streaming as first-class parts of the domain.
3. **A real backend** — a service with its own lifecycle, schema migrations,
   background work, and failure modes. Not just route handlers next to components.
4. **Self-hosted deployment** — containerised, reverse-proxied, backed up, and
   reachable from a phone in a supermarket.

### Non-goals

- Horizontal scale or high availability. This serves a handful of households (§4.1).
- Public internet exposure. Access is via the LAN or a private tunnel (§8.4).
- Mobile-native apps. An installable PWA covers the phone use case.

---

## 2. The domain

Architecture without a domain is hand-waving, so here is the thing being built.

| Entity | Notes |
|---|---|
| **Household** | The tenant. Every row below belongs to exactly one. |
| **User** | A person. Belongs to one or more households via `HouseholdMember` (user_id, household_id, role). |
| **Recipe** | Title, source URL, servings, prep/cook time, steps, tags. Has many `RecipeIngredient`. |
| **Ingredient** | A household's food vocabulary ("plum tomato"), with aliases and a store section. Deduplicated within the household; seeded from a starter catalogue. |
| **RecipeIngredient** | Join row: quantity, unit, preparation note ("finely chopped"), optional flag. |
| **MealPlan** | A week. Has many `PlannedMeal`. |
| **PlannedMeal** | (date, slot: breakfast/lunch/dinner, recipe, servings). |
| **ShoppingList** | Derived from a `MealPlan`, grouped by store section. Has many `ShoppingListItem`, each with a checked flag: tick off what's already at home, then what's in the basket. |
| **AiCall** | Audit row for every Claude request — household, feature, model, tokens, cost, latency. |

**There are no shared tables.** Every row, `Ingredient` included, carries a
`household_id`. A shared ingredient vocabulary looks free but isn't: households will
add their own items, and then someone has to decide who may rename or merge a shared
row, and per-household attributes (which store section, what *you* call it) need an
override table anyway. Scoping it like everything else keeps `forHousehold()` and the
isolation test (§4.1) free of exceptions. A new household gets a starter catalogue
copied in from `packages/core`, so nobody starts from an empty list. Recipe import
maps extracted names onto the household's catalogue by normalised name and aliases,
creating rows for misses. The cost is that sharing a recipe across households maps
ingredients by name on copy, which is acceptable for a rare action.

**There is no pantry.** Keeping household stock accurate is a chore nobody keeps up,
and an inaccurate pantry is worse than none. The shopping list is generated in full,
and the user checks off what's already at home. Check state is persisted, so
regenerating the list after a plan change keeps the ticks on lines that still exist.

The interesting logic — the part worth writing tests for before writing any UI — is
**shopping list aggregation**: merging `2 cloves garlic` + `1 tbsp minced garlic` +
`half a bulb` into one line item requires unit normalisation, density-aware
conversion for a few ingredient classes, and a deliberate decision about what to do
when conversion is impossible (answer: keep them as separate sub-lines rather than
guess). This is pure, deterministic, dependency-free domain code. It belongs in
`packages/core` and it should be the best-tested code in the repo.

---

## 3. Technology choices

Versions are what's current as of 2026-09-22 and are worth pinning at scaffold time.

### 3.1 Language & tooling

| Concern | Choice | Version |
|---|---|---|
| Language | TypeScript, `strict: true` + `noUncheckedIndexedAccess` | 7.0 |
| Runtime | Node.js (LTS from late October 2026) | 26.x |
| Package manager | pnpm workspaces | 12.x |
| Task orchestration | Turborepo | 2.11 |
| Lint + format | Biome (one tool, no ESLint/Prettier split) | 2.5 |
| Validation | Zod | 4.x |

**On TypeScript 7:** the compiler is now the native (Go) port, which is
dramatically faster on a monorepo. It is worth adopting here — fast feedback is a
large part of why monorepo type safety is pleasant rather than painful. Keep
`tsc --noEmit` as the typecheck gate; let Vite and `tsdown`/`tsc` handle emit.

**On Biome over ESLint + Prettier:** one binary, one config, near-instant on a repo
this size. The ESLint plugin ecosystem is richer, but nothing here needs it.

### 3.2 Backend

| Concern | Choice | Version |
|---|---|---|
| HTTP framework | Hono + `@hono/node-server` | 4.13 / 2.1 |
| Route definition & validation | `@hono/zod-openapi` | 1.6 |
| ORM / query builder | Drizzle ORM (`sqlite-core`) + drizzle-kit | 0.45 / 0.31 |
| Database | SQLite via `better-sqlite3` (bundles SQLite 3.53, FTS5, JSON) | 13.0 |
| Vector search (phase 6) | `sqlite-vec` loaded as an extension | 0.1.9 |
| Backup | Litestream (continuous replication) | 0.5.x |
| Auth | better-auth | 1.7 |
| Logging | pino | 10.x |
| LLM | `@anthropic-ai/sdk` | 0.127 |
| Effects (inside `packages/ai` only) | `effect` + `@effect/vitest` | 3.22 / 0.30 |

**Why Hono over Fastify or NestJS.** Hono is built on web-standard `Request`/
`Response`, which means its streaming story (`streamSSE`) composes directly with the
Anthropic SDK's async iterators — relevant, since streaming is a core feature here
and not an afterthought. Its type inference is the best of the three, and it exports
an `AppType` that the frontend can consume for a fully-typed client with no codegen
step (§4). Fastify is the more battle-tested choice with a richer plugin ecosystem,
but its generic-heavy typing is clunkier. NestJS brings decorators and DI that this
codebase is far too small to repay.

**Why Drizzle over Prisma.** Drizzle's schema *is* TypeScript, and row types are
inferred from it with no generate step — which means a schema change surfaces as a
type error immediately rather than after `prisma generate`. It emits SQL you can
read, which matters if part of the point is learning SQL. The `sqlite-core` dialect
is first-class, and `drizzle-kit` still generates migrations from the schema.

**Why SQLite rather than Postgres.** The workload is a household: thousands of rows,
a handful of writes a minute at peak. Against that, SQLite removes a container, a
connection pool, a `pg_upgrade` path, and a backup strategy, and it makes the test
suite an order of magnitude faster (§3.4). The capabilities that looked like
Postgres-only turn out not to be: FTS5 covers recipe search, and `sqlite-vec`
covers the phase-6 vector work.

What we give up, and the mitigation in each case:

| Lost | Mitigation |
|---|---|
| Rich column types (`timestamptz`, `jsonb`, arrays, enums, `uuid`) | Drizzle mode mappings + Zod at the boundary. The guarantee moves from the database to `packages/contracts` |
| `SELECT … FOR UPDATE SKIP LOCKED` for the job queue | One worker process, `BEGIN IMMEDIATE` and a claim update (§6.4) |
| Unrestricted `ALTER TABLE` | drizzle-kit emits table-recreate migrations. Review them; don't skim them |
| pgvector | `sqlite-vec` — works, with one papercut (§6.4) |
| Concurrent writers | WAL gives one writer + many readers. Irrelevant at this scale, with one rule attached (§6.4) |

**Why Drizzle and not Kysely.** Kysely is closer in spirit to a minimal SQL wrapper,
and `kysely-codegen` derives types from the live schema. Drizzle wins on migrations:
`drizzle-kit` generates them from the TypeScript schema, where Kysely expects you to
hand-write every one.

The idiomatic Drizzle query builder covers the ergonomics that would otherwise argue
for raw SQL. `and()` drops `undefined` operands, so conditional filters compose
without a fragment helper:

```ts
const listRecipes = (householdId: HouseholdId, f: RecipeFilter) =>
  db.select().from(recipes).where(and(
    eq(recipes.householdId, householdId),                                  // always
    f.maxMinutes == null ? undefined : lte(recipes.totalMinutes, f.maxMinutes),
    f.tag == null ? undefined : exists(
      db.select().from(recipeTags).where(and(
        eq(recipeTags.recipeId, recipes.id),
        eq(recipeTags.tag, f.tag)))),
  ))
```

With both optional filters absent that emits `where "household_id" = ?` and nothing
else — no dangling `and`, no empty parentheses. Keep `sql` for the places SQL genuinely
reads better than a builder: the shopping-list aggregation and the FTS5 match queries.
Everything else goes through the builder.

**Why better-auth.** TypeScript-native, has a first-party Drizzle adapter, and
handles sessions, email+password, and passkeys without a hosted dependency.
The homelab-conventional alternative is forward-auth via Authelia or Authentik at the
reverse proxy — operationally cleaner, but it moves auth out of the TypeScript you
wanted to practise. Keep the option: the app only needs a trusted identity header to
switch later.

### 3.3 Frontend

| Concern | Choice | Version |
|---|---|---|
| Build tool | Vite | 8.x |
| UI | React | 19.3 |
| Routing | TanStack Router (typed routes) | 1.x |
| Server state | TanStack Query | 5.x |
| Forms | TanStack Form | 1.x |
| Styling | Tailwind CSS | 4.3 |
| Components | shadcn/ui (copied in, not a dependency) | — |

TanStack Router earns its place specifically because of goal #1: route params and
search params are typed and validated with the same Zod schemas as everything else,
so a bad link is a compile error. TanStack Query handles caching, optimistic updates
for the plan grid, and — importantly — plays well with the manual stream handling in
§6.2, because streaming responses sit *outside* the query cache and write into it on
completion.

### 3.4 Testing

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest 5 | Domain logic in `packages/core` — aggregation, unit conversion, date maths |
| Integration | Vitest + in-memory SQLite | API routes against a real schema, fresh DB per test file |
| Contract (AI) | Vitest + recorded fixtures | Our parsing/mapping of Claude responses (§6.4) |
| Query contract | Vitest + in-memory SQLite | Every query executed and Zod-parsed — catches SQL/schema drift |
| E2E | Playwright 1.63 | Two or three critical paths only: import a recipe, plan a week, generate a list |

Dropping Postgres drops Testcontainers with it. A fresh in-memory SQLite database
costs microseconds, so integration tests need no Docker, no daemon, and no fixture
teardown — each test file gets its own database and throws it away.

That cheapness buys a test worth writing explicitly: **execute every query in the
codebase against a fresh schema and Zod-parse the result.** If a query stops
returning a column its schema declares, the test fails. Seed the fixtures with nulls
in every nullable column, or nullability drift slips through.

---

## 4. The type-safety chain

This is the spine of the project. Each link is checked by the compiler.

```
  Drizzle sqlite-core schema (packages/db/schema.ts)
        │  inferred row types, migrations via drizzle-kit
        ▼
  Zod domain + DTO schemas (packages/contracts)
        │
        ├──► @hono/zod-openapi route defs ──► runtime validation + OpenAPI 3.1 doc
        │           │
        │           └──► export type AppType
        │                      │
        │                      ▼
        │                hc<AppType>() typed client ──► TanStack Query hooks ──► React
        │
        └──► zodOutputFormat(schema) ──► Claude structured output
```

The last branch is the part worth being deliberate about. The *same* Zod schema that
validates a `POST /recipes` body is the schema handed to
`client.messages.parse({ output_config: { format: zodOutputFormat(...) } })`. The
consequence: an AI-extracted recipe is, by construction, a valid API payload. There
is no translation layer between "what the model produced" and "what the system
accepts", and no class of bug where they drift apart.

**Deliberate separation:** `packages/db` types are *not* the API types. Database rows
carry internal columns (surrogate keys, timestamps, soft-delete flags) that the API
shouldn't leak, and API shapes want nesting the tables don't have. `drizzle-zod` can
bootstrap the DTO schemas, but they stay explicit and hand-maintained in
`packages/contracts`. Conflating the two is the single most common way a project like
this ends up with a database schema it can't change.

**Known risk:** Hono's `hc` client infers the whole route tree, and TS inference time
grows super-linearly with route count. At a few dozen routes this is invisible. If
the editor starts lagging, the mitigations in order are: split into sub-routers and
type each independently; or switch the client to `openapi-typescript` +
`openapi-fetch` generated from the OpenAPI doc the server already emits. The second
costs a codegen step but has flat inference cost — and the doc is already there, so
it's a contained change rather than a rewrite.

### 4.1 Multi-tenancy

Every tenant-scoped table carries `household_id` from the first migration. Adding it
later would mean backfilling every table and rewriting every query, and under SQLite
that is a table-recreate per table — so it goes in now even while it only ever holds
one value.

Adding the column is the easy part. The hard part is that a tenant leak is one
forgotten `where` clause, and nothing in TypeScript notices. Four mechanisms, in
descending order of how much they actually protect you:

**1. The raw handle never escapes `packages/db`.** The package exports
`forHousehold(householdId)`, not `db`. Every repository function is reached through
it, and the predicate is applied inside:

```ts
// packages/db — the only place the Drizzle handle is in scope
export function forHousehold(id: HouseholdId) {
  return {
    recipes: {
      list: (f: RecipeFilter) => db.select().from(recipes)
        .where(and(eq(recipes.householdId, id), ...filters(f))),
      byId: (recipeId: RecipeId) => db.select().from(recipes)
        .where(and(eq(recipes.householdId, id), eq(recipes.id, recipeId))).get(),
    },
    // …
  }
}
```

Forgetting the scope stops being a discipline problem, because there is no API that
lets you forget it. This is the mechanism that does the real work; the rest are
backstops.

**2. Branded IDs.** `HouseholdId`, `RecipeId`, and `UserId` are branded strings, not
bare `string`. Passing a `UserId` where a `HouseholdId` belongs is a compile error
rather than a silent empty result set. Cheap, and it catches the confusions that
actually happen.

**3. Composite primary keys and composite foreign keys.** Tenant tables are keyed on
`(household_id, id)`, and references between them carry the household through:

```sql
create table planned_meals (
  household_id text not null,
  id           text not null,
  recipe_id    text not null,
  primary key (household_id, id),
  foreign key (household_id, recipe_id) references recipes(household_id, id)
);
```

The database then refuses to let a meal in one household point at a recipe in
another — a class of bug that survives a correct `where` clause, because the join
itself is what's wrong. I verified SQLite enforces this:

```
insert into planned_meals values ('h1','m1','r2')  -- h1 meal → h2 recipe
  → FOREIGN KEY constraint failed
```

Two caveats. `better-sqlite3` issues `PRAGMA foreign_keys = ON` on every connection it
opens, but SQLite's own default is OFF — anything reaching the file by another path
(the `sqlite3` CLI, a different driver) will not enforce these, so treat it as a
property of the connection and not of the file. And drizzle-kit's table-recreate
migrations drop and rebuild foreign keys, so read those migrations rather than
approving them on sight (§8.4).

**4. An isolation test.** Seed two households, then call every repository function as
household A and assert it returns nothing belonging to B. Because an in-memory SQLite
database costs microseconds (§3.4), this can run over the whole repository surface on
every test run rather than a sampled subset. Make it a loop over the exported
repository object so a newly added function is covered the day it's written — not one
hand-maintained case per function, which is the version that rots.

**Where the household comes from.** better-auth resolves the session to a `UserId`;
Hono middleware looks up `household_members` and puts a `HouseholdId` on the request
context. A user can belong to several households, so the active one is part of the
session, not a column on the user. The `household_id` is never read from a request
body or a query parameter.

**The AI layer has one extra rule: tenant scope is closed over, never a tool
parameter.** Tools in §6.3 are constructed bound to the household from the request
context. If `household_id` were an argument in a tool's input schema, the model could
supply any value — and a hallucinated identifier would be indistinguishable from an
attack. The model gets tools that can only see one household because that is the only
household they were built to see.

**Indexing.** `household_id` goes first in every composite index. Every query filters
on it, so an index that doesn't lead with it is mostly wasted.

**The alternative, for the record:** SQLite makes database-per-tenant unusually
attractive — one file per household gives perfect isolation and a trivially simple
backup story. It is rejected here because cross-household features (sharing a recipe
with your in-laws) turn into cross-database work, and because at one-to-three
households the column costs less. If this ever became a real multi-tenant product,
that trade would be worth revisiting.

---

## 5. Repository layout

```
meal-planner/
├── apps/
│   ├── api/                    # Hono service
│   │   ├── src/
│   │   │   ├── routes/         # zod-openapi route definitions
│   │   │   ├── services/       # use-cases; orchestrate db + ai + core
│   │   │   ├── jobs/           # background worker + handlers
│   │   │   ├── env.ts          # Zod-validated process.env, fails fast at boot
│   │   │   └── app.ts          # exports AppType
│   └── web/                    # Vite + React SPA (PWA)
├── packages/
│   ├── contracts/              # Zod schemas + inferred types. Depends on nothing.
│   ├── core/                   # Pure domain logic. Depends only on contracts.
│   ├── db/                     # Drizzle schema, migrations, client factory
│   └── ai/                     # Anthropic client, prompts, tools, capabilities
│                               #   the one Effect package; exports Promises (§6.5)
├── docker/
│   ├── compose.yaml
│   ├── Dockerfile              # api image (multi-stage)
│   ├── Caddyfile
│   └── litestream.yml
├── docs/
│   └── architecture.md         # this file
└── turbo.json
```

The dependency rule is one-directional and worth enforcing (Biome can, or just
review): `contracts` ← `core` ← `db`/`ai` ← `api` ← nothing. `core` must stay
free of I/O so it can be tested at microsecond speed.

---

## 6. AI architecture

Three distinct capabilities, each exercising a different part of the Claude API.
They live behind named functions in `packages/ai` — not a generic `askClaude()`.
A generic wrapper is how prompt logic ends up scattered through route handlers.

`packages/ai` is also the one place in the codebase written with **Effect** (§6.5).
The boundary is the package: inside it, capabilities are `Effect` values; at the
exported edge they are `Promise`s, and nothing outside needs to know.

Model: **`claude-opus-5`** throughout, with adaptive thinking
(`thinking: { type: "adaptive" }`) on the reasoning-heavy paths. Cost at household
volume is a few cents a month; picking a weaker model to save money here would be
optimising the wrong thing.

### 6.1 Capability 1 — Recipe import (structured outputs)

`extractRecipe(input: { url } | { image } | { text }): Promise<RecipeDraft>`

The highest value-to-effort feature in the project, and the right one to build first.

**Do not reach for the LLM immediately.** Most recipe sites publish
`schema.org/Recipe` JSON-LD. The pipeline is:

1. Fetch the page server-side (never from the browser — CORS, and the API key
   never leaves the server).
2. Look for JSON-LD `Recipe`. If found and it parses against the schema, **return
   it. Zero tokens, instant, deterministic.**
3. Otherwise strip the HTML to text and send it to Claude with
   `messages.parse()` + `zodOutputFormat(RecipeDraftSchema)`.
4. For a photo of a cookbook page, send the image as a base64 content block with
   the same output schema.

Step 2 is the part with the actual engineering lesson in it: don't use a language
model where a parser will do. The LLM is the fallback, and the fallback rate is a
metric worth logging.

`parsed_output` is `null` when parsing fails — guard it rather than asserting, and
surface a "couldn't read this one, enter it manually" path in the UI.

### 6.2 Capability 2 — Streaming assistant (SSE)

`streamChat(messages, ctx): AsyncIterable<ChatEvent>`

Conversational refinement: *"swap Tuesday for something faster"*, *"make the whole
week vegetarian"*.

```
Anthropic client.messages.stream()
    → async iterator of SDK events
    → map into OUR event envelope          ← the important step
    → Hono streamSSE()
    → browser fetch + ReadableStream reader
    → Zod-parse each event
    → React state
```

**Design decision: define our own event envelope rather than forwarding raw SDK
events to the browser.** Something like:

```ts
export const ChatEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"),      text: z.string() }),
  z.object({ type: z.literal("thinking"),  text: z.string() }),
  z.object({ type: z.literal("tool_start"), name: z.string() }),
  z.object({ type: z.literal("done"),      messageId: z.string() }),
  z.object({ type: z.literal("error"),     code: z.string(), message: z.string() }),
]);
```

Three reasons: the client stops depending on the Anthropic SDK's event shape (which
is versioned by Anthropic, not by us); the envelope is Zod-validated on both ends, so
it stays inside the type-safety chain; and it gives a natural place to redact
anything the browser shouldn't see. The cost is a mapping function — cheap, and it's
the seam where a provider swap would happen if you ever wanted one.

Set `thinking: { display: "summarized" }` if you want to render reasoning — the
default is `"omitted"`, which streams empty thinking blocks and looks to the user
like a long pause before anything happens.

### 6.3 Capability 3 — Week planning (agentic tool use)

`planWeek(constraints, ctx): Promise<MealPlanDraft>`

*"Plan next week, vegetarian, nothing over 30 minutes on weeknights, use up the
courgettes, don't repeat anything from the last fortnight."*

This is a genuine agent: the model needs to look things up before it can answer.
Use `client.beta.messages.toolRunner` with `betaZodTool`-defined tools:

| Tool | Purpose |
|---|---|
| `search_recipes` | Filter by tag, max time, ingredient, exclusions ("use up the courgettes" is an ingredient filter, not a pantry lookup) |
| `get_recent_meals` | Avoid repetition |
| `propose_plan` | Terminal tool — validated `MealPlanDraft`, ends the loop |

Guardrails, because an agent with database access is a liability without them:

- Every tool is **read-only** except `propose_plan`, which returns a draft the user
  confirms in the UI. Nothing is written to the database by the model.
- Tool inputs are Zod-validated (`betaZodTool` does this), and every tool is built
  over `forHousehold(ctx.householdId)` — the scope is closed over, never an argument
  the model supplies (§4.1). The model's arguments are untrusted input, exactly like
  a request body.
- A hard iteration cap and a `task_budget` so a confused loop can't run up a bill.
- Every tool call logged with its arguments. When a plan comes out strange, the
  trace tells you whether the problem was the prompt, the data, or the tools.

### 6.4 Cross-cutting AI concerns

**Cost & usage accounting.** Every call writes an `ai_calls` row: feature name,
model, `usage.input_tokens`, `usage.output_tokens`,
`usage.cache_read_input_tokens`, latency, outcome. This is ten lines of middleware
and it gives you a real cost dashboard, a cache hit-rate metric, and the data to
answer "is this feature worth it". Build it with the first capability, not later.

**Prompt caching.** Render order is `tools` → `system` → `messages`. Keep the system
prompt and tool definitions byte-stable (no timestamps, no interpolated user names,
deterministic tool ordering) and put volatile content last, behind the last
`cache_control` breakpoint. Then *verify* — if `cache_read_input_tokens` is zero
across repeated requests, something in the prefix is changing. The `ai_calls` table
makes this a query rather than an investigation.

**Error handling.** The SDK's exceptions are narrowed most-specific first —
`NotFoundError` → `RateLimitError` → `APIStatusError` → `APIConnectionError` — and
mapped onto the tagged error union in §6.5, because the retry policy differs per
case. Check `stop_reason` before reading `content`; a `refusal` returns HTTP 200
with content you shouldn't parse, and is never retried.

**Offline degradation.** The homelab will lose its internet connection. AI endpoints
must fail soft behind a feature flag, and every AI-powered flow needs a manual
equivalent: type the recipe in by hand, drag meals onto the plan yourself. The
shopping list — the thing you actually need in a shop — must have no AI in its
critical path at all.

**Background jobs.** URL import and week planning take seconds to tens of seconds;
they shouldn't hold an HTTP request open. A `jobs` table, a `BEGIN IMMEDIATE`
transaction to claim the next row, and a worker loop in the API process is about 80
lines and adds no infrastructure. SQLite has no `SKIP LOCKED`, but with a single
worker there is nothing to skip — the immediate transaction is the whole lock.

**Never hold a write transaction open across an `await` on the Anthropic API.** A
20-second model call inside a transaction blocks every other write in the process.
Call Claude first, *then* open a transaction and write the result. Pleasantly,
`better-sqlite3`'s synchronous API makes this structurally impossible: you cannot
`await` inside `db.transaction()`, because it isn't async. The footgun is designed
out — but the rule still applies to any hand-rolled `BEGIN`/`COMMIT` pair.

**Search.** SQLite's FTS5 covers recipe search: an external-content virtual table
over title, ingredients, and tags, kept in sync by triggers. `better-sqlite3` bundles
SQLite 3.53 with FTS5 and JSON compiled in, so there is nothing to install.

**Semantic search (later).** Anthropic has no embeddings endpoint, so this needs a
separate model. Do FTS5 first — it is genuinely good and costs nothing. If you later
want *"that soup with the coconut milk"* to work, add `sqlite-vec` (loaded at
connection time via `loadExtension`) with a local embedding model — `transformers.js`
running `bge-small` in-process — rather than a second API dependency.

One verified papercut: `sqlite-vec` 0.1.9 rejects a `rowid` bound as a plain JS
number from `better-sqlite3` 13 (`Only integers are allows for primary key values`).
Bind a `BigInt` instead — `stmt.run(1n, vec)` works. Worth a comment in the code, or
you will lose an evening to it.

### 6.5 Effect, scoped to this package

Everything in §6.4 — retry with backoff, timeouts, rate limiting, spans, typed
failure — is what an effect system is for. Rather than hand-roll each one as
middleware, `packages/ai` is written in Effect and exports plain `Promise`s.

```ts
const extractRecipe = callClaude.pipe(
  Effect.retry({
    schedule: Schedule.exponential(Duration.seconds(1)).pipe(Schedule.jittered),
    while: (e) => e._tag === "RateLimited",     // retry this, never a Refusal
    times: 4,
  }),
  Effect.timeout(Duration.seconds(30)),
  Effect.withSpan("ai.extractRecipe"),
)
```

Failures are tagged errors — `RateLimited`, `Refused`, `ParseFailed`, `Timeout` —
so the retry predicate is exhaustive over a union the compiler knows, rather than a
string match on a message. The same union maps to HTTP status codes in one
`Match` at the route boundary.

**Two rules keep the adoption bounded.**

*The package is the boundary.* Capability functions are `Effect` values internally;
the package exports `Promise`-returning functions that `Effect.runPromise` at the
edge and map the error channel onto ordinary rejected promises with typed causes.
Hono routes, services, and the job worker see nothing but async functions. If Effect
is later judged not to have earned its place, it is deleted from one package.

*Effect for effects, Zod for data.* Effect's `Schema` is capable — it emits
`additionalProperties: false` by default, so it would drive Claude's structured
outputs fine — but adopting it would mean either migrating `packages/contracts`
wholesale or running two schema libraries, and two is strictly worse than one. Zod
stays the single data language and the §4 type-safety chain is untouched. Effect
handles control flow only.

**What it buys, concretely:** `Schedule` composes backoff, jitter, and caps as a
value, so the retry policy is testable in isolation; `Semaphore` caps API
concurrency in one line; `Effect.withSpan` emits OpenTelemetry spans with no
tracing setup, which feeds the `ai_calls` accounting (§6.4) and gives §8.7 a head
start; and `@effect/vitest`'s `TestClock` makes retry and timeout paths
deterministic — the backoff test runs instantly instead of actually sleeping
fifteen seconds.

**The cost, stated honestly.** Effect is a paradigm, not a library. Coming from
cats-effect the concepts transfer almost entirely — `Ref`, `Deferred`, `Fiber`,
`Queue`, `Scope`, `Stream`, `Schedule` are the same ideas under the same names — but
three things are genuinely different: no higher-kinded types, so no tagless final;
`Effect.gen(function* () { … })` in place of a for-comprehension, and generators are
single-use; and type errors on long pipelines get rough, because `E` and `R`
accumulate as unions. Note also that `Effect<A, E, R>` puts its parameters in the
opposite order to ZIO's `ZIO[R, E, A]`.

**When to widen it.** The obvious next step is the `R` channel for tenancy:
`Effect<Recipe, NotFound, Database | Household>` cannot be run without a household
provided, which promotes §4.1's structural scoping from a convention about module
exports into the type system. That is a real improvement, and it is deliberately
deferred — it only pays off once the call stack from route to repository is Effect
throughout, which means replacing the Hono and Drizzle integration layers.
Revisit it after phase 5, with actual experience, rather than deciding now.

---

## 7. Security

Small app, but the habits are the point.

- **The API key never reaches the browser.** All Claude calls are server-side. This
  falls out of the architecture rather than needing discipline, which is the idea.
- **Config validated at boot.** `apps/api/src/env.ts` parses `process.env` with Zod
  and throws on startup if `ANTHROPIC_API_KEY` or `DATABASE_URL` is missing. Fail at
  deploy, not on first request.
- **SSRF on recipe import.** `POST /recipes/import { url }` makes the server fetch an
  arbitrary URL — the classic SSRF hole. Allow `https` only, resolve the hostname and
  reject private/loopback/link-local ranges, cap redirects, cap response size, set a
  timeout. This matters more than usual because the server sits *inside* a homelab
  with other services on the same network.
- **Tenant isolation is structural, not procedural** (§4.1): the Drizzle handle never
  leaves `packages/db`, composite foreign keys stop cross-household references at the
  database, and an isolation test sweeps the whole repository surface.
- **Model output is untrusted input.** Tool arguments get validated and re-authorised
  server-side. Extracted recipe text gets rendered as text, never as HTML.
- **Container hardening.** Run the API as a non-root user with `no-new-privileges`
  and `cap_drop: [ALL]`. Running the stack under rootless Podman (§8.2) adds a second
  layer for free. This pairs directly with the SSRF surface above: the two highest-risk
  pieces of this app are an outbound fetcher and an LLM with tool access.
- **Secrets.** A `.env` on the host, gitignored, mode `600`. Docker secrets or SOPS +
  age is the next step when you want the config in git.

---

## 8. Deployment

### 8.1 Topology

Single host: a Synology Plus-series NAS (x86_64) running Docker through DSM's
**Container Manager** package, which runs a Compose file as a "Project". SQLite removed
the database container, so there are two services:

```
              ┌──────────────────────────────────────────┐
  LAN ───────►│ caddy      :8443 TLS, static SPA, /api/* │
  VPN         └────────────┬─────────────────────────────┘
                           │ /api/* → api:3000
              ┌────────────▼─────────────────────────────┐
              │ api    Node 26 + Hono                    │──► api.anthropic.com
              │        litestream -exec "node ..."       │──► off-host replica
              │                                          │
              │        /data/app.db  ◄── named volume ───┼──► real fs, NOT overlay
              └──────────────────────────────────────────┘
```

Caddy serves the built SPA as static files and reverse-proxies `/api/*` — no separate
web container, and no CORS, because everything is same-origin.

DSM's own web server already holds ports 80 and 443 on the NAS, so Caddy publishes high
ports (8080/8443) instead. Moving DSM off them is possible but fights every DSM update,
so the app's URL carries the port.

**The one rule that matters here: the SQLite file must never live on the container's
overlay filesystem.** SQLite's WAL mode depends on POSIX advisory locking and coherent
mmap of the `-shm` file, and overlay and network filesystems
[break both, with corruption as the symptom rather than an error](https://sqlite.org/howtocorrupt.html).
Put it on a named volume — a real host filesystem — and never in a path that falls
through to the image's writable layer. This was a non-issue with Postgres and is now
the single most important deployment detail.

### 8.2 Docker on the NAS, Podman on the dev machine

Two runtimes consume the same Compose file: rootful Docker (Container Manager) on the
NAS, and rootless Podman on the development machine, through `podman compose` or the
Docker CLI pointed at Podman's compatible socket. Images are OCI either way, so nothing
in the build changes. The rule that keeps one file working on both:

- **`compose.yaml` holds only what both accept** — named volumes, `cap_drop`,
  `security_opt: [no-new-privileges:true]`, `depends_on` with conditions, published
  high ports. Podman-only settings such as `userns: keep-id` go in a
  `compose.podman.yaml` override used only on the dev machine; Docker rejects them.
- **Healthchecks live in `compose.yaml`, not the Dockerfile.** Podman builds OCI-format
  images by default, and the OCI format has no `HEALTHCHECK`, so a Dockerfile
  healthcheck silently vanishes from a locally built image.
- **Assume an older Docker.** Container Manager's Docker Engine and Compose plugin
  trail upstream releases. Stick to long-established Compose features and check
  `docker version` and `docker compose version` on the NAS before reaching for anything
  recent.

Three more things bite only on the rootless dev side:

- **Privileged ports.** A rootless container cannot bind 443 — another reason the
  Compose file publishes high ports.
- **Volume ownership.** Rootless maps container UIDs into your subuid range, so files
  a container writes appear on the host owned by a high-numbered UID. Invisible for
  named volumes; for bind mounts use `userns: keep-id` so `litestream restore` works
  without `sudo`. Keep `app.db` on a named volume and bind-mount only read-only config.
- **SELinux.** On Fedora/RHEL, bind mounts need a `:Z` or `:z` suffix or the container
  gets permission denied on a path that looks perfectly readable.

On the NAS, a Docker named volume lives under the data volume (`/volume1/@docker`),
which is btrfs or ext4 — a real filesystem, so §8.1's rule holds. Never point the
database at a shared folder that is itself mounted over the network.

### 8.3 Images

Multi-stage Dockerfile for the API:

1. **deps** — `pnpm fetch` against the lockfile only, so the layer caches until a
   dependency actually changes.
2. **build** — install, compile, then `pnpm deploy --filter=api --prod` for a pruned
   `node_modules` without the workspace dev tree.
3. **runtime** — `node:26-alpine`, non-root user, pruned output plus the Litestream
   binary. The healthcheck hitting `/health` is declared in Compose (§8.2).

The NAS is x86_64, so CI builds `linux/amd64` images only.

`better-sqlite3` is a native module: build it in the same base image the runtime stage
uses, or the prebuilt binary will not match the runtime's libc. `node:26-alpine` is
musl — if prebuilds give trouble, `node:26-slim` (glibc) is the boring fix.

Entrypoint wraps the app in Litestream so replication and process lifetime are the
same thing:

```
litestream replicate -exec "node dist/main.js"
```

The SPA is a separate build stage whose `dist/` is copied into the Caddy image.

### 8.4 Config, migrations, backups

- **Config:** env vars only, `.env` on the host, mode `600`, gitignored. Nothing
  environment-specific baked into an image.
- **Migrations:** drizzle-kit generates SQL files, committed to git. They run as an
  explicit step — a one-shot Compose service or `compose exec` — **not** on API boot.
  Auto-migrate on boot is how you discover a bad migration during a restart loop. With
  SQLite this matters more than usual: drizzle-kit emits table-recreate migrations for
  column changes, so read them rather than skimming them. A table recreate also drops
  and rebuilds foreign keys — see the tenancy note in §4.1 before approving one.
- **Backups:** Litestream replicates continuously to a second physical disk or an
  S3-compatible target, which beats a nightly dump — the recovery point is seconds,
  not a day. Two caveats: Litestream v0.5 rewrote its storage format to LTX and
  [the v0.3 → v0.5 migration path has open bugs](https://github.com/benbjohnson/litestream/issues/1512),
  so start on v0.5 and don't plan to upgrade across it; and v0.5 dropped age
  encryption. Keep a periodic `VACUUM INTO` snapshot alongside — a single consistent
  file you can copy anywhere is worth having when the replica is what went wrong.
  **Restore one and check the row counts.** A backup you have never restored is a
  hypothesis.

### 8.5 Access from outside the LAN

A shopping list is used in a shop, which is not on your LAN. This is a real
constraint, not a detail, and it has two answers:

- **The router's VPN** (recommended). The UniFi gateway's built-in remote access —
  Teleport or its WireGuard VPN server — puts the phone on the LAN from anywhere, with
  nothing on the NAS exposed to the internet and no extra software on the NAS. The app
  needs nothing VPN-specific: to it, a remote phone is just another LAN client.
- **Offline-first PWA.** Installable, caches the current shopping list, works with no
  connectivity at all. Worth doing anyway — supermarket signal is bad — but local
  writes and sync are a real project. Phase it as read-only caching first: the list
  renders offline, ticking items off syncs when you're back.

Do the VPN first; treat offline write sync as a stretch goal.

**TLS on the LAN.** A PWA's service worker only runs in a secure context, so the app
needs HTTPS with a certificate the phone trusts. The plan: a hostname on a domain you
own, resolved to the NAS's LAN address by a local DNS record on the UniFi gateway (VPN
clients use the gateway for DNS too), and a certificate Caddy obtains through ACME
DNS-01 — which needs no inbound port, so nothing is exposed. Caddy's internal CA is the
fallback, at the cost of installing its root certificate on every device. See §11.

### 8.6 CI/CD

GitHub Actions on push: Biome → `tsc --noEmit` → Vitest → build image → push to GHCR.

Deployment is a pull, not a push: `docker compose pull && docker compose up -d` on the
NAS, run over SSH (or from the Project in Container Manager's UI) by hand or by a small
`make deploy`. The NAS logs in to GHCR once with a read-only token
(`docker login ghcr.io`) so it can pull private images. Manual deploys are honestly
fine for a household app, and knowing exactly when one happened makes debugging easier.

Local development needs no containers at all — SQLite is a file and the API is a Node
process. `pnpm dev` is the whole story, which is a real improvement over waiting for a
Postgres container to become healthy.

### 8.7 Observability

Start small and add when something actually hurts:

- pino structured JSON logs to stdout, read via `docker compose logs`.
- `/health` (process alive) and `/ready` (can open and query the database), wired to
  Compose healthchecks.
- The `ai_calls` table doubles as AI observability from day one.
- OpenTelemetry plus a Grafana/Loki/Tempo stack is the natural next step and a good
  standalone learning project — but adding it before there's traffic to look at means
  maintaining dashboards nobody reads.

---

## 9. Build order

Each phase ends with something deployed and usable. The sequencing is deliberate:
infrastructure first while it's cheap to change, domain logic before UI polish, AI
only once there's data for it to work on.

| Phase | Deliverable | Why here |
|---|---|---|
| **0. Walking skeleton** | Monorepo, CI, Compose, Caddy, SQLite, `/health`, one typed route rendered in the SPA — **deployed to the homelab** | Deploy on day one. Every later phase is then a small delta, and you never face a big-bang first deploy. |
| **1. Households + recipes** | Auth, `household_members`, `forHousehold()` repositories, the isolation test, then recipe CRUD typed end-to-end | Tenancy lands with the first tables, not after them. Proves the type chain and gives the AI features somewhere to write. |
| **2. Plan & shopping list** | Week grid, aggregation, unit conversion, store sections | The genuinely interesting domain logic. Heavy unit tests, no AI, no network. |
| **3. AI: recipe import** | JSON-LD fast path → Claude structured-output fallback, photo import, `ai_calls` logging. Effect enters here, in `packages/ai` only | First AI feature, highest value, and it's the one that fills the database. Effect lands with the first code that needs retries and timeouts, not before. |
| **4. AI: streaming chat** | SSE envelope, Hono `streamSSE`, React stream consumer | Streaming touches every layer — good architectural stress test. |
| **5. AI: week planning agent** | Tool runner, three tools, draft-and-confirm UX, budget caps | Needs phases 1–3 in place to have anything to reason over. |
| **6. Polish** | PWA + remote access over the router's VPN, `sqlite-vec` semantic search, cost dashboard, Playwright E2E | The "actually use it" phase. |

Phases 0–2 are a working meal planner with no AI in it. That is intentional: if the
Anthropic API is down, or you run out of credits, or you just want to add a recipe on
a plane, the app still does its job.

---

## 10. Decisions and the alternatives rejected

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| App shape | Hono API + Vite SPA, monorepo | Next.js fullstack | Keeps a real server-side boundary; the backend is the thing being practised. |
| API contract | Hono `hc` + zod-openapi | tRPC | Same end-to-end types, but real REST semantics and a free OpenAPI doc. tRPC couples client to server more tightly. |
| ORM | Drizzle `sqlite-core` | Kysely | Kysely is closer to raw SQL, but Drizzle generates migrations and its `sql` fragments compose just as well. |
| Datastore | SQLite (`better-sqlite3`) | Postgres; libSQL; PGlite | Household scale. FTS5 and `sqlite-vec` cover what pgvector/`tsvector` would have. Removes a container, a pool, and an upgrade path. |
| Search | FTS5 | Postgres `tsvector` | Compiled into `better-sqlite3` already; nothing to install. |
| Jobs | `jobs` table + `BEGIN IMMEDIATE` | BullMQ + Redis | No `SKIP LOCKED` needed with one worker; ~80 lines; no new container. |
| Tenancy | `household_id` column + `forHousehold()` repositories | Database-per-tenant; add it later | Structural isolation without cross-database joins. Retrofitting the column under SQLite means a table recreate per table. |
| Auth | better-auth in-app | Authelia/Authentik forward-auth | Keeps auth in the TypeScript being practised; can move to the proxy later. |
| Lint/format | Biome | ESLint + Prettier | One tool, one config, far faster. |
| Containers | Docker Compose | Podman Quadlet; k3s | Compose is the portable interface — Podman runs the same file, so local dev can be rootless without the deployment target changing. |
| Backups | Litestream continuous | Nightly dump | Recovery point in seconds. Keep a periodic `VACUUM INTO` snapshot alongside it. |
| Remote access | UniFi gateway VPN (Teleport / WireGuard) | Tailscale; port-forward + DDNS | Nothing exposed to the internet, and the router already does it — no agent on the NAS. |
| Effects | Effect, inside `packages/ai` only | Effect everywhere; plain async/await | Retries, timeouts, typed failures and spans are what it's for, and the package boundary keeps it reversible. Everywhere means re-deciding Hono, Drizzle and Zod. |
| AI provider | Anthropic hosted | Local Ollama | Structured outputs and tool use are reliable, which is what these features depend on. |

### Where this would change

- **If Effect doesn't earn its place:** it lives in one package behind a
  `Promise`-returning interface (§6.5). Removing it means rewriting `packages/ai`
  internals against plain async/await — no caller changes.
- **If AI cost or privacy became a concern:** `packages/ai` is the seam. Its three
  capability functions are the entire surface; swapping the implementation for a
  local model means rewriting one package, not the app. Structured extraction would
  need the most rework — small local models are much weaker at schema adherence.
- **If it outgrew one host:** SQLite makes the API stateful — the database is a file
  on a volume, so the app is pinned to one node. That is a deliberate trade, not an
  oversight: horizontal scale is an explicit non-goal (§1). The migration path, if it
  ever mattered, is SQLite → Postgres, and it is a real one — Drizzle's `sqlite-core`
  and `pg-core` are different dialects, so `packages/db` gets rewritten. Keeping every
  query behind repository functions in that package is what bounds the blast radius,
  and is the reason the dependency rule in §5 is worth enforcing.
- **If route count made `hc` inference slow:** switch to `openapi-typescript` +
  `openapi-fetch` against the OpenAPI doc the server already emits. Contained change.

---

## 11. Open questions

1. ~~Household or single user?~~ **Decided:** multi-tenant from phase 1 (§4.1).
   The remaining sub-question is concurrent editing — two people dragging meals onto
   the same week will clobber each other. Last-write-wins is fine to start; note it
   rather than solve it, and revisit if it actually bites.
2. **Metric or imperial, or both?** Affects the unit-conversion core and whether
   recipes store canonical units with display-time conversion (recommended) or store
   whatever was entered.
3. **Does Effect widen past `packages/ai`?** Deliberately deferred to after phase 5
   (§6.5). The `R`-channel tenancy argument is good; the cost is replacing the Hono
   and Drizzle integration layers. Decide with experience, not in advance.
4. ~~How far does the pantry go?~~ **Decided:** no pantry. The shopping list is
   checked off against what's at home (§2).
5. **Which domain and DNS provider for the LAN certificate?** §8.5 assumes a domain
   whose DNS provider Caddy has an ACME DNS-01 plugin for; without one, fall back to
   Caddy's internal CA. Decide before the Caddy image is built (phase 0), because a
   DNS plugin means a custom Caddy build.
