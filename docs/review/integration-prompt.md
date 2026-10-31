# Independent integration reviewer task

Give this assignment to a fresh reviewer before it sees individual findings.
Supply full base/tip SHAs, an exclusive tip worktree, snapshotted workflow/guidance,
project brief, PR/issue paths, and absolute report/log paths. Replace placeholders before dispatch.

```text
Review the integrated stack <base SHA>..<tip SHA> in <worktree>.
Follow <workflow path> and <guidance paths>.
Requirements and PR context: <paths>.
Current owner priorities and amendments: <project brief paths>.
Write <report path>; save verbose evidence under <logs path>.

Verify the worktree's revision. Read relevant architecture sections and inspect the
combined change. Do not read individual commit findings before writing this report.
Trace complete flows across package and commit boundaries. For each relevant issue,
identify what is implemented, what is verified, and what still requires evidence.
Assess whether the result fits the current build phase and project goals. Evaluate
intentional architectural changes as proposals with reasons and tradeoffs.

Assess whether the stack as a whole is worth keeping. Owner priorities take precedence
over older architecture/issue assumptions. Recommend the smallest coherent design
that meets current needs, including keep/simplify/defer/drop recommendations for
features or whole commits. Explain operating and maintenance costs, ownership,
coupling, simpler alternatives, lost capabilities, and dependencies of any removal.
Correct code can still be unnecessary. Assess accumulated complexity across commits;
do not assume all existing mechanisms need a place in the final design. Keep these
recommendations separate from defects, and identify docs/issues needing revision.

For this project's walking skeleton, relevant flows include contract → API → SPA,
image build → configuration → migration → healthy service, and backup → restore →
verification. Select flows relevant to the actual range; do not require future-phase
features. Inspect deployment instructions without executing against real systems.

Use the commit report's evidence and severity conventions. Record precise code
references at the tip, checks performed, coverage gaps, and architectural concerns.
Run relevant integrated checks in this worktree, recording unavailable tools and
manual acceptance tasks. Do not fix code or change the manifest. Report candidate
cross-commit defects without guessing their introducing SHA.

Return only completion status, finding count, material limitations, and report path.
```
