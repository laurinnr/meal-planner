# Commit reviewer task

Fill in the assignment below and give it to a fresh reviewer with no inherited
conversation. Replace every placeholder before dispatch.

```text
Review one commit. Produce evidence-backed findings; do not fix the code.

Commit: <full SHA>
Parent: <full SHA>
Worktree: <absolute path>
Workflow: <absolute path to snapshotted review-workflow.md>
Repository guidance: <absolute paths to supplied/applicable AGENTS.md>
Project brief: <absolute path to current owner priorities and any amendments>
PR/issue context: <absolute paths, or explicitly unavailable>
Report: <absolute output path>
Logs: <absolute directory>

Read the workflow, guidance, and project brief. Verify HEAD matches the assigned SHA. Read the
parent-to-commit diff, relevant architecture sections at this revision, and the
surrounding implementation. Follow dependencies when needed. Do not read other
reviewers' reports or later revisions; the coordinator checks later fixes.

Review correctness, failure behavior, architecture, meaningful tests, scope, and
whether this commit works independently. Treat PR verification claims as unverified
until reproduced. Distinguish introduced defects from pre-existing ones and design
questions. Only flag concrete problems with a supported trigger and impact; do not
invent findings or enforce stylistic preferences already handled by the formatter.

Also assess whether this change is worth having for the current project. Recommend
keep, simplify, defer, or drop, with the current need, ongoing maintenance cost,
smallest adequate alternative, and capability lost if omitted. Evaluate package
ownership and operational burden. Owner priorities supersede older design/issue
assumptions. A concrete simplification proposal does not require a correctness bug;
record it separately rather than inflating defect severity. Do not assume all code
must be retained or propose a new abstraction merely to relocate a small tool.

Run the applicable validation in your own worktree using its pinned dependencies.
Save verbose output in Logs. Record exact commands and outcomes, including checks
that are unavailable. Use disposable data. You own only this worktree and your
report/log files; do not change the source checkout, manifest, or other workers'
files. Record and undo temporary reproduction changes before final checks. Do not
commit, push, deploy, or modify real databases.

Write the report using the structure below. End by returning only the SHA, review
status, finding count, major limitations, and report path (roughly 150 words).
```

## Report structure

- Identity: SHA, parent, PR/issues, worktree, date, instruction/context sources.
- Coverage: changed areas and dependencies inspected; anything not inspected.
- Validation table: command, revision/cwd, exit status, passed/failed/unavailable/
  not applicable, evidence path. Describe what the checks actually establish.
- Confirmed findings, or explicitly "No confirmed introduced defects found."
- Project fit: keep/simplify/defer/drop, rationale, simpler alternative, tradeoff,
  and any questions. Distinct from confirmed defects; passing tests is not a verdict.
- Acceptance gaps, environmental limitations, and pre-existing issues.
- Completion status and remaining work.

For each finding, include a stable local ID such as `<short-sha>-01`, severity,
title, introducing SHA, file and narrow line range at that SHA, trigger, observed or
reasoned impact, evidence/reproduction, suggested correction, and verification.
State whether reproduced or established by inspection. Tip status is
`not assessed` until synthesis.

Severity expresses impact, not certainty:

- P0: immediate severe damage or exposure; stop until resolved.
- P1: blocks expected operation, risks data loss, or defeats a critical guarantee.
- P2: a concrete defect under a supported scenario that should be corrected.
- P3: a smaller actionable defect; not personal style or speculative future needs.

Unsupported suspicions belong under questions with the evidence needed to resolve
them. Do not turn a missing local tool into a product defect.
