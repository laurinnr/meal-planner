---
name: commit
description: Commit, stack, and open PRs in this repo using Conventional Commits and GitHub stacked PRs (gh stack). Use whenever committing, starting a branch, adding a layer to a stack, opening or updating PRs, or syncing after a merge.
---

# Commit & stacked PRs

This repo uses **GitHub stacked PRs** via the official `gh stack` extension, and
**Conventional Commits** for every commit message and PR title. Work items are
**GitHub issues**.

Prerequisite: `gh extension install github/gh-stack` (check with `gh stack --help`).

## The model

- **One branch = one PR = one reviewable change.** A stack is an ordered chain of
  them, each based on the one below; the bottom one targets `main`.
- **PRs are rebase-merged.** Every commit on a branch lands on `main` as written,
  with no merge commit and no squash. So:
  - **every commit** is a valid Conventional Commit, not just the PR title;
  - every commit stands on its own — it builds and its tests pass;
  - review follow-ups are folded into the commit they fix (see §4), never pushed
    as "address review" / "fix typo" commits.
- One commit per branch is the default. Several are fine when each is a meaningful
  step on its own (e.g. a refactor that prepares the feature, then the feature).
- Branch names: `<type>/<short-kebab-slug>`, e.g. `feat/recipe-crud`,
  `chore/agpl-license`.

## Conventional Commits

```
<type>(<scope>)!: <subject>

<body: why, not what — optional>

<footer: Refs #12 / BREAKING CHANGE: … — optional>
```

| type | for |
|---|---|
| `feat` | user-visible capability |
| `fix` | bug fix |
| `refactor` | behaviour-preserving restructure |
| `perf` | performance |
| `test` | tests only |
| `docs` | documentation only |
| `build` | build system, dependencies, Dockerfile |
| `ci` | GitHub Actions |
| `chore` | everything else (tooling, config, licensing) |
| `revert` | reverting a previous commit |

Scopes follow the repo layout: `api`, `web`, `contracts`, `core`, `db`, `ai`,
`infra` (Compose, Caddy, Litestream), `deps`. Omit the scope for repo-wide changes.
Needing more than one scope is a sign the commit should be split.

Subject: imperative mood, lowercase, no trailing period, ≤ 72 characters including
the prefix. `!` after the scope (and a `BREAKING CHANGE:` footer) for breaking
changes. Keep any attribution trailers the harness asks for.

The PR title follows the same format: the commit subject for a single-commit PR,
or a summary of the whole branch otherwise.

## Workflow

Always stage explicit paths (`git add <paths>`), never `git add -A` / `-Am`: the
working tree may hold unrelated changes.

Never run interactive commands, they hang without a TTY: `gh stack submit` without
`--auto`, `gh stack modify`, `gh stack switch`, `gh stack checkout` without an
argument, `gh stack add -A` without `-m`, `git rebase -i`.

### 1. Orient

```sh
git status --short
gh stack view --short     # errors if the current branch isn't in a stack
```

### 2. Start a stack (new piece of work)

```sh
git switch main && git pull --ff-only
gh stack init <type>/<slug>
# edit, then:
git add <paths> && git commit -m "<type>(<scope>): <subject>"
```

### 3. Add a layer on top

Only from the topmost branch (`gh stack top`):

```sh
gh stack add <type>/<slug>      # creates and checks out the new branch
git add <paths> && git commit -m "<type>(<scope>): <subject>"
```

Split when a change has an independently reviewable foundation (schema → repository
→ route → UI is a natural stack). Don't split one logical change across layers just
to make PRs smaller.

### 4. Fold a change into an existing commit

On the branch that owns the commit (`gh stack checkout <branch>` or
`gh stack down [n]`):

```sh
# into the branch's last commit
git add <paths> && git commit --amend --no-edit

# into an earlier commit on the branch
git add <paths> && git commit --fixup <sha>
git rebase --autosquash <parent-branch>    # non-interactive since git 2.44

# then, either way
gh stack rebase --upstack       # restack the branches above
gh stack push                   # only if the stack is already on GitHub
```

On conflict: resolve, `git add`, `gh stack rebase --continue` (or `--abort`).

### 5. Open the PRs — ask the user first

Pushing and opening PRs is outward-facing: confirm before doing it.

```sh
gh stack submit --auto          # pushes, opens draft PRs, links the stack
gh stack view --json            # PR numbers per branch
```

`--auto` titles are generated, so set each PR's title and body afterwards:

```sh
gh pr edit <n> --title "<type>(<scope>): <subject>" --body "<body>"
```

PR body: what and why in a few lines, then the issue link. Use `Closes #N` on the
PR that completes the issue and `Refs #N` on earlier layers working toward it —
put the closing keyword in the PR body, not a commit, so a rebase-merged commit
can't close an issue early. If no issue exists for the work, ask whether to create
one (`gh issue create`) rather than skipping the link. End the body with the
attribution line the harness specifies.

Leave PRs as drafts unless the user asks; `gh stack submit --open` (or
`gh pr ready <n>`) marks them ready.

### 6. After a merge

```sh
gh stack sync --prune           # fetch, restack onto main, push, drop merged branches
```

If sync reports local and remote stacks have diverged, it aborts without a TTY —
stop and ask the user rather than resolving it by force.

### Merging

The user merges. If asked to: `gh stack merge --rebase` merges the whole stack (or
up to a given PR) all-or-nothing.
