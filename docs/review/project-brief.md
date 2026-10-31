# Project priorities for review

Owner direction, 2026-10-31, updated after the daily-backup simplification. Read this
alongside the architecture and issue snapshots. These priorities guide whether a
change is worth keeping, even when it correctly implements an earlier plan.

- Keep this household-scale, self-hosted project simple to understand and maintain.
  There are no strict SLAs or SLOs. Daily backups and losing changes since the last
  successful daily backup are acceptable; continuous replication is not a requirement.
- Continuous replication, including Litestream, is deferred. Reconsider it only if
  a shorter recovery point or a specific learning goal justifies its configuration,
  credentials, process lifecycle, restore procedures, and maintenance.
- Question bespoke operational tools and their placement. The small `snapshot.ts`
  CLI shares the existing API image and SQLite runtime; database primitives stay in
  `packages/db`. Row-count comparison was removed in favor of integrity and known
  historical contents. Do not create an operations package merely to move a script.
- The project's learning goals remain relevant. Name a concrete learning benefit
  when it justifies extra machinery; do not assume every additional abstraction or
  service is useful practice.

Assess the actual implementation and explain the smallest adequate alternative.
Daily backup tolerance does not remove the need for a consistent backup and a usable
restore procedure. Do not replace a small tool with a new package, service, or generic
framework merely to tidy its location. Removing or deferring a feature is a valid
recommendation; do not assume that every existing file must survive the review.

Review recommendations do not authorize implementation or deployment by themselves.
Older PR/issue snapshots may still describe replication or live row-count comparisons;
distinguish those superseded requirements from current acceptance work. Daily backup
scheduling, off-NAS delivery and a real-host restore still need operational evidence;
local tests alone do not establish deployment acceptance.
