# Meal Planner — Architecture & Technology Plan

A fullstack TypeScript application for planning meals, run self-hosted on a homelab
local network. This document is the design brief: what we're building, what we're
building it with, and why.

**Status:** draft v1 — pre-implementation
**Last reviewed:** 2026-09-22

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

- Multi-tenancy, horizontal scale, or high availability. This serves a household.
- Public internet exposure. Access is via the LAN or a private tunnel (§8.4).
- Mobile-native apps. An installable PWA covers the phone use case.

---

## 2. The domain

Architecture without a domain is hand-waving, so here is the thing being built.

| Entity | Notes |
|---|---|
| **Recipe** | Title, source URL, servings, prep/cook time, steps, tags. Has many `RecipeIngredient`. |
| **Ingredient** | Canonical food item ("plum tomato"). Deduplicated across recipes. |
| **RecipeIngredient** | Join row: quantity, unit, preparation note ("finely chopped"), optional flag. |
| **MealPlan** | A week. Has many `PlannedMeal`. |
| **PlannedMeal** | (date, slot: breakfast/lunch/dinner, recipe, servings). |
| **ShoppingList** | Derived from a `MealPlan`, minus pantry. Grouped by store section. |
| **PantryItem** | What's already in the house, with quantity and optional expiry. |
| **AiCall** | Audit row for every Claude request — feature, model, tokens, cost, latency. |

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
| Runtime | Node.js (current LTS line) | 24.x |
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
| ORM / query builder | Drizzle ORM + drizzle-kit | 0.45 / 0.31 |
| Database | PostgreSQL (`pgvector/pgvector:pg17`) | 17 |
| Auth | better-auth | 1.7 |
| Logging | pino | 10.x |
| LLM | `@anthropic-ai/sdk` | 0.127 |

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
read, which matters if part of the point is learning Postgres. Prisma 8 is a fine
alternative with better tooling (Studio, a friendlier migration UX) and would be the
right call if you wanted to lean on the tooling rather than the SQL.

**Why Postgres and nothing else.** One datastore covers relational data, full-text
search (`tsvector`), vector similarity (pgvector), and the job queue (§6.3). Adding
Redis or Elasticsearch to a household app would be learning infrastructure for its
own sake — and the `pgvector/pgvector:pg17` image means the extension is there the
day you want it, with no migration.

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
| Integration | Vitest + Testcontainers 12 | API routes against a real ephemeral Postgres |
| Contract (AI) | Vitest + recorded fixtures | Our parsing/mapping of Claude responses (§6.4) |
| E2E | Playwright 1.63 | Two or three critical paths only: import a recipe, plan a week, generate a list |

---

## 4. The type-safety chain

This is the spine of the project. Each link is checked by the compiler.

```
  Drizzle schema (packages/db/schema.ts)
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
│   │   └── Dockerfile
│   └── web/                    # Vite + React SPA (PWA)
├── packages/
│   ├── contracts/              # Zod schemas + inferred types. Depends on nothing.
│   ├── core/                   # Pure domain logic. Depends only on contracts.
│   ├── db/                     # Drizzle schema, migrations, client factory
│   └── ai/                     # Anthropic client, prompts, tools, capabilities
├── docker/
│   ├── compose.yaml
│   ├── compose.dev.yaml        # Postgres only, for local dev
│   └── Caddyfile
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
| `search_recipes` | Filter by tag, max time, ingredient, exclusions |
| `get_pantry` | What needs using up, and by when |
| `get_recent_meals` | Avoid repetition |
| `propose_plan` | Terminal tool — validated `MealPlanDraft`, ends the loop |

Guardrails, because an agent with database access is a liability without them:

- Every tool is **read-only** except `propose_plan`, which returns a draft the user
  confirms in the UI. Nothing is written to the database by the model.
- Tool inputs are Zod-validated (`betaZodTool` does this) and every tool re-applies
  the user's authorisation scope server-side — the model's arguments are untrusted
  input, exactly like a request body.
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

**Error handling.** Catch a chain, most-specific first — `NotFoundError` →
`RateLimitError` → `APIStatusError` → `APIConnectionError` — because the retry
policy differs per case. Check `stop_reason` before reading `content`; a `refusal`
returns HTTP 200 with content you shouldn't parse.

**Offline degradation.** The homelab will lose its internet connection. AI endpoints
must fail soft behind a feature flag, and every AI-powered flow needs a manual
equivalent: type the recipe in by hand, drag meals onto the plan yourself. The
shopping list — the thing you actually need in a shop — must have no AI in its
critical path at all.

**Background jobs.** URL import and week planning take seconds to tens of seconds;
they shouldn't hold an HTTP request open. A `jobs` table in Postgres with
`SELECT ... FOR UPDATE SKIP LOCKED` and a worker loop in the API process is about
80 lines and has no new infrastructure. If you specifically want to learn queues,
BullMQ + Redis is the upgrade — but it adds a container and a failure mode for
capacity this app will never need.

**Semantic search (later).** Anthropic has no embeddings endpoint, so this needs a
separate model. Start with Postgres full-text search — `tsvector` over title,
ingredients, and tags is genuinely good and costs nothing. If you later want *"that
soup with the coconut milk"* to work, add pgvector with a local embedding model
(`transformers.js` running `bge-small` in-process) rather than a second API
dependency. The image already has the extension.

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
- **Model output is untrusted input.** Tool arguments get validated and re-authorised
  server-side. Extracted recipe text gets rendered as text, never as HTML.
- **Secrets.** A `.env` on the host, gitignored, mode `600`. Docker secrets or SOPS
  + age is the next step when you want the config in git.

---

## 8. Deployment

### 8.1 Topology

Single host, Docker Compose, four services:

```
              ┌──────────────────────────────────────────┐
  LAN ───────►│ caddy      :443  TLS, static SPA, /api/* │
  Tailscale   └────────────┬─────────────────────────────┘
                           │ /api/* → api:3000
              ┌────────────▼──────────┐
              │ api        Node 24    │──► api.anthropic.com
              │            Hono       │
              └────────────┬──────────┘
                           │
              ┌────────────▼──────────┐   ┌──────────────┐
              │ db   pgvector/pg17    │◄──│ backup       │
              │      named volume     │   │ nightly dump │
              └───────────────────────┘   └──────────────┘
```

Caddy serves the built SPA as static files directly and reverse-proxies `/api/*` —
no separate web container, and no CORS, because everything is same-origin.

### 8.2 Images

Multi-stage Dockerfile for the API:

1. **deps** — `pnpm fetch` against the lockfile only, so the layer caches until a
   dependency actually changes.
2. **build** — install, `tsc`/bundle, then `pnpm deploy --filter=api --prod` to
   produce a pruned `node_modules` without the workspace's dev tree.
3. **runtime** — `node:24-alpine`, non-root user, only the pruned output copied in,
   `HEALTHCHECK` hitting `/health`.

The SPA is a separate build stage whose `dist/` is copied into the Caddy image.

### 8.3 Config, migrations, backups

- **Config:** env vars only, `.env` on the host. Nothing environment-specific baked
  into an image.
- **Migrations:** drizzle-kit generates SQL files, committed to git. They run as an
  explicit step (a one-shot Compose service or `docker compose exec`), **not**
  automatically on API boot — auto-migrate on boot is how you find out about a bad
  migration during a restart loop.
- **Backups:** nightly `pg_dump` to a mounted host path, 14 days retained, and that
  path included in whatever backs up the homelab. A backup you have never restored is
  a hypothesis — restore one into a scratch container once and confirm the row counts.

### 8.4 Access from outside the LAN

A shopping list is used in a shop, which is not on your LAN. This is a real
constraint, not a detail, and it has two answers:

- **Tailscale** (recommended). The host joins your tailnet; the phone reaches it from
  anywhere with nothing exposed to the internet. With Tailscale's HTTPS certs you
  also get a trusted certificate without a DNS-01 dance.
- **Offline-first PWA.** Installable, caches the current shopping list, works with no
  connectivity at all. Worth doing anyway — supermarket signal is bad — but it means
  thinking about local writes and sync, which is a real project of its own. Phase it
  as read-only caching first: the list renders offline, ticking items off syncs when
  you're back.

Do Tailscale first; treat offline write sync as a stretch goal.

### 8.5 CI/CD

GitHub Actions on push: Biome → `tsc --noEmit` → Vitest (unit + Testcontainers
integration) → build images → push to GHCR.

Deployment is a pull, not a push: `docker compose pull && docker compose up -d` on
the host, run by hand or by a small `make deploy` over SSH. Watchtower automates it
if you want, but manual deploys are honestly fine for a household app, and knowing
exactly when a deploy happened makes debugging easier.

### 8.6 Observability

Start small and add when something actually hurts:

- pino structured JSON logs to stdout, read via `docker compose logs`.
- `/health` (process alive) and `/ready` (Postgres reachable), wired to Compose
  healthchecks.
- The `ai_calls` table doubles as AI observability from day one.
- OpenTelemetry + a Grafana/Loki/Tempo stack is the natural next step, and a good
  standalone learning project — but adding it before there's traffic to look at means
  maintaining dashboards nobody reads.

---

## 9. Build order

Each phase ends with something deployed and usable. The sequencing is deliberate:
infrastructure first while it's cheap to change, domain logic before UI polish, AI
only once there's data for it to work on.

| Phase | Deliverable | Why here |
|---|---|---|
| **0. Walking skeleton** | Monorepo, CI, Compose, Caddy, Postgres, `/health`, one typed route rendered in the SPA — **deployed to the homelab** | Deploy on day one. Every later phase is then a small delta, and you never face a big-bang first deploy. |
| **1. Recipes** | Full CRUD, typed end-to-end, migrations, integration tests | Proves the type chain and gives the AI features something to write into. |
| **2. Plan & shopping list** | Week grid, aggregation, unit conversion, store sections | The genuinely interesting domain logic. Heavy unit tests, no AI, no network. |
| **3. AI: recipe import** | JSON-LD fast path → Claude structured-output fallback, photo import, `ai_calls` logging | First AI feature, highest value, and it's the one that fills the database. |
| **4. AI: streaming chat** | SSE envelope, Hono `streamSSE`, React stream consumer | Streaming touches every layer — good architectural stress test. |
| **5. AI: week planning agent** | Tool runner, four tools, draft-and-confirm UX, budget caps | Needs phases 1–3 in place to have anything to reason over. |
| **6. Polish** | PWA + Tailscale, pgvector semantic search, cost dashboard, Playwright E2E | The "actually use it" phase. |

Phases 0–2 are a working meal planner with no AI in it. That is intentional: if the
Anthropic API is down, or you run out of credits, or you just want to add a recipe on
a plane, the app still does its job.

---

## 10. Decisions and the alternatives rejected

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| App shape | Hono API + Vite SPA, monorepo | Next.js fullstack | Keeps a real server-side boundary; the backend is the thing being practised. |
| API contract | Hono `hc` + zod-openapi | tRPC | Same end-to-end types, but real REST semantics and a free OpenAPI doc. tRPC couples client to server more tightly. |
| ORM | Drizzle | Prisma | Types without codegen; readable SQL; smaller runtime. |
| Datastore | Postgres only | + Redis / Elasticsearch | One database covers relational, FTS, vectors, and jobs at this scale. |
| Jobs | Postgres `SKIP LOCKED` | BullMQ + Redis | No new container; ~80 lines; sufficient for household volume. |
| Auth | better-auth in-app | Authelia/Authentik forward-auth | Keeps auth in the TypeScript being practised; can move to the proxy later. |
| Lint/format | Biome | ESLint + Prettier | One tool, one config, far faster. |
| Deploy | Docker Compose | k3s | Debuggable, sufficient, and doesn't spend the project's budget on YAML. |
| Remote access | Tailscale | Port-forward + DDNS | Nothing exposed to the internet. |
| AI provider | Anthropic hosted | Local Ollama | Structured outputs and tool use are reliable, which is what these features depend on. |

### Where this would change

- **If AI cost or privacy became a concern:** `packages/ai` is the seam. Its three
  capability functions are the entire surface; swapping the implementation for a
  local model means rewriting one package, not the app. Structured extraction would
  need the most rework — small local models are much weaker at schema adherence.
- **If it outgrew one host:** the API is already stateless (sessions in Postgres, no
  local disk), so the move to k3s is packaging, not re-architecture. That's the main
  reason to keep it 12-factor now even though nothing requires it.
- **If route count made `hc` inference slow:** switch to `openapi-typescript` +
  `openapi-fetch` against the OpenAPI doc the server already emits. Contained change.

---

## 11. Open questions

1. **Household or single user?** Multiple users means the plan is shared and edits
   collide. Worth deciding now — retrofitting a `household_id` onto every table
   later is unpleasant. Recommendation: put the column in from phase 1 even if it
   always holds one value.
2. **Metric or imperial, or both?** Affects the unit-conversion core and whether
   recipes store canonical units with display-time conversion (recommended) or store
   whatever was entered.
3. **How far does the pantry go?** Full inventory tracking with depletion is a
   commitment to keeping it accurate, and an inaccurate pantry is worse than none.
   A lighter "things to use up" list gets most of the value into the planning agent
   for a fraction of the effort.
