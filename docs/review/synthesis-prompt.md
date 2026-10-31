# Synthesis task

Supply the pinned manifest, all completed report paths, evidence directory, workflow
and guidance paths, current project brief/amendments, and an output path. This task follows independent integration
review. For a pilot, explicitly label the limited scope and pending reviews.

```text
Consolidate review run <manifest path> following <workflow/guidance paths>.
Read reports from <paths> and write <summary path>.
Use current owner priorities from <project brief/amendment paths>.

Check coverage against every inventoried commit. Start with report summaries; load
code and detailed evidence for candidate findings as needed. Reports are claims to
verify, not authoritative conclusions. Resolve contradictions using code at the
recorded SHAs and focused reproductions. Preserve unresolved uncertainty explicitly.

Deduplicate by root cause while retaining all affected commits/PRs. Verify the
introducing commit and whether each defect remains at the pinned tip. Mark findings
as present at tip, resolved later (with fixing SHA), or unresolved. Keep historical
commit-independence failures distinct from final-state defects. Separate pre-existing
issues, architectural concerns, and unavailable acceptance checks.

Produce a distinct project-fit verdict alongside correctness: keep, simplify, defer,
or drop for each reviewed commit/feature. Reconcile these into a minimal coherent
design, accounting for dependencies and the capabilities intentionally given up.
Prioritize unnecessary features for removal before polishing their implementation.
Do not treat passing tests or conformance to an older issue as proof a feature is
needed. Reassess earlier project-fit conclusions if the owner's brief changed;
identify them as pending until revisited. Preserve historical validation evidence.

Lead with confirmed merge blockers and recommended fix order. Include an issue
acceptance matrix and a commit coverage table showing reviewed/no findings,
reviewed/findings, incomplete, or pending. Distinguish executed checks from the PR
author's claims. A missing test tool is not a passing check. State explicitly whether
this is a full-stack report or a partial pilot; do not issue a full-stack verdict when
reviews remain pending. Do not fix code, amend commits, or publish findings.
```
