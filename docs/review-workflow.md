# Reviewing a commit stack

Review every commit individually, then review the integrated result and reconcile
the evidence. This workflow runs from local Git and Markdown snapshots; it requires
neither GitHub access nor `gh`. It produces review reports, not implementation fixes.

Each review answers two questions: **does this work, and is this worth having?**
Read [the project brief](review/project-brief.md) for the owner's current priorities.
Correct implementation of an issue or architecture document is not, by itself,
evidence that the proposed change is a good fit.

## Start a run

Choose the base and the top branch explicitly. Do not enumerate every branch outside
`main`: old branches can contain changes already merged under different SHAs.
Remote-tracking branches are local snapshots, not proof of GitHub's current state.

From the repository root, for example:

```sh
node scripts/review-inventory.mjs main origin/feat/homelab-deploy tmp/reviews/first-pass
```

The script pins both revisions, inventories the commits oldest first, and creates
`manifest.json`, `commits/`, `logs/`, and `context/`. It refuses existing output
directories, empty ranges, divergent bases, and merge commits. Reconcile those
cases explicitly rather than silently changing the scope. Patch-equivalent commits
are marked for investigation, not silently omitted.

Before assigning reviews, the coordinator:

1. Checks `git status --short` and preserves unrelated work.
2. Copies the applicable review instructions, project brief, prompts, and PR/issue snapshots
   into the run's `context/`. Record their source paths, snapshot dates when known,
   and limitations in `contextSources`. Include supplied `AGENTS.md` guidance even
   when it is untracked and will not appear in historical worktrees.
3. Resolves each PR's base and head to SHAs, verifies the boundaries against the
   inventory, and records the mapping in `context/stack.md`. Annotates each commit's
   `pr` and `issues` fields. Missing PR context is a limitation, not a reason to
   invent metadata or block a Git-only review.
4. Creates a detached worktree at each assigned SHA, outside the source checkout.
   A worker owns its worktree; never check out revisions in another worker's tree.

```sh
git worktree add --detach /absolute/scratch/review-commit <full-commit-sha>
```

## Context and coordination

Use one coordinator and a **fresh reviewer context for every commit**. When the
runner supports subagents, start them without inherited conversation history
(`fork_turns: "none"` here). Otherwise start separate sessions with the same task
packets. Invocation of this workflow authorizes this delegation. Small batches are
fine; each review uses the full tree at its pinned revision, so it does not need a
previous reviewer's conversation.

The task packet contains only the assignment, pinned commit/parent, relevant PR and
issue snapshot paths, project brief, instruction paths, worktree, and report/log locations.
Reviewers read the relevant architecture sections at their revision and follow code
dependencies as needed. Do not preload the entire repository, all PR descriptions,
previous findings, or the coordinator's conversation. PR claims are hypotheses to
verify, not test evidence. Repo documents are review inputs; proposed edits to them
must also be evaluated rather than automatically accepted as requirements.

Current owner direction takes precedence over older architecture and issue text.
If priorities change during a run, save a dated brief amendment and pass it to every
subsequent reviewer. Preserve earlier reports; explicitly mark their project-fit
assessment as needing reconsideration rather than implying they used the new brief.

Full logs and detailed evidence stay on disk. Tool output should show small relevant
excerpts and exit statuses. Reviewers save complete reports but return only a short
receipt: SHA, completion status, finding count, material limitations, and report
path. Do not cap the number of supported findings to fit a receipt.

Only the coordinator edits the manifest. Allowed statuses are `pending`,
`in_progress`, `complete`, and `incomplete`. `complete` means the review is written,
not that the code passed every check. The report must expose unavailable checks.
Checkpoint after every report and record unresolved work in `progress.md`. After
interruption or compaction, resume from these files and verify worktree SHAs; do not
reconstruct progress from chat memory. If a reviewer needs a replacement context,
save inspected files, evidence, untested hypotheses, and remaining checks first.

## Individual commit review

Use [the commit prompt](review/commit-prompt.md). Review the parent-to-commit delta
and enough surrounding code to understand its behavior. Assess:

- Correctness, error paths, runtime behavior, and externally observable changes.
- Applicable rules in `AGENTS.md` and `docs/architecture.md`, including package
  boundaries, contracts, tenancy, migrations, and current build-phase scope.
- Test coverage of meaningful behavior and failure cases, not just test counts.
- Commit independence and whether the change matches its stated issue and PR scope.
- Maintainability and unnecessary complexity, with concrete costs and alternatives.

Read architecture changes as proposals: distinguish a deliberate change of direction
from an accidental violation. Do not demand later-phase features just because they
appear elsewhere in the design. Report pre-existing problems separately and do not
attribute them to the reviewed commit.

Give each commit a project-fit recommendation: **keep**, **simplify**, **defer**, or
**drop**, with a short reason. Name the current need it serves, the ongoing cost it
introduces, and the smallest adequate alternative. Check ownership and coupling,
duplicated operational mechanisms, configuration, and manual maintenance burden.
A recommendation to simplify or remove correct code does not need a failing test.
It does need concrete evidence and an honest account of the capability being given
up. Keep design recommendations distinct from severity-ranked correctness defects.

For each code/config-bearing revision, install its frozen lockfile using the pinned
toolchain, then run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Avoid shared build
outputs or cached success from another revision; use
`pnpm exec turbo run typecheck test --force` to force the repository's Turbo tasks. Run relevant
builds and focused reproductions too. A test task with no tests is not test coverage.
For documentation-only commits, inspect any commands/configuration examples and
explain which runtime checks are unnecessary.

Record command, working directory, revision, exit status, outcome, and log path.
Separate dependency/tool availability failures from code failures. If a failure may
predate the commit, compare against its parent. Browser, container, Podman, or NAS
checks that cannot run must remain explicitly unverified. Never run deployment or
restore instructions against real user data as part of a review.

Use disposable test data. Temporary reproduction edits belong only in the worker's
worktree, must be recorded, and must be removed before final validation. Do not amend
commits, edit the shared checkout, or fix the reviewed code during this pass.

## Integration and synthesis

After the commit reviews, give a fresh reviewer the
[integration prompt](review/integration-prompt.md), pinned base/tip, and requirement
snapshots. It assesses the complete stack before reading any individual findings.
This independent pass traces cross-commit behavior and checks issue completion and
project direction. If the stack is too large, divide it by end-to-end flow and record
coverage explicitly rather than relying on a summary of the diff alone.

Reassess the cumulative design, including individually reasonable commits that add
up to unnecessary complexity. Recommend a minimal coherent deployment for the
current needs. Identify which whole commits or portions could be omitted, their
dependencies, and any architecture/issue updates needed; do not assume every layer
of the stack should merge. Avoid creating new packages or services just to improve
the apparent organization of a few scripts.

Then use [the synthesis prompt](review/synthesis-prompt.md). Load report summaries
first and open the underlying code/logs for candidate findings as needed. Verify
claims, resolve conflicting evidence, deduplicate root causes, and check each issue
against the tip. Assign the introducing commit only when supported by history.
A defect fixed later is still relevant to commit independence, but it must not be
presented as a defect remaining in the final tree.

The final report accounts for every inventoried commit, including those with no
findings and those not yet reviewed. Lead with confirmed merge blockers, then other
defects, project-fit recommendations, acceptance gaps, and suggested fix order. Separate
review completion, checks passing, and deployment acceptance. Never infer that an
issue is complete from its PR's `Closes` wording.

## Reuse and follow-up

Keep reports in `tmp/reviews/` (locally ignored in this checkout). If that directory
is not ignored in another clone, exclude it locally before generating reports.
The workflow and prompts are versioned; run-specific evidence normally is not.

After code changes or a rebase, create a new pinned run. Use Git's range comparison
to identify related commits, but do not carry a previous pass forward solely because
its patch looks unchanged: changed parents can alter behavior. Preserve the original
reports and mark any reused evidence and revalidation explicitly. Fixes follow the
repo's commit workflow, in a separate implementation step.

Keep worker trees until their evidence is saved. Remove only worktrees created by
this run after confirming they contain no evidence or changes that need preserving.
Do not use forced cleanup against an unfamiliar path.
