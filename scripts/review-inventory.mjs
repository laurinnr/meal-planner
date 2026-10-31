import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function revision(ref) {
  return git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
}

function main() {
  const [baseRef, tipRef, output, ...extra] = process.argv.slice(2);
  if (!baseRef || !tipRef || !output || extra.length) {
    throw new Error("Usage: node scripts/review-inventory.mjs <base> <tip> <new-run-directory>");
  }

  const repository = git("rev-parse", "--show-toplevel").trim();
  const base = revision(baseRef);
  const tip = revision(tipRef);
  const mergeBase = git("merge-base", base, tip).trim();
  if (mergeBase !== base) {
    throw new Error(
      "Base is not an ancestor of tip. Reconcile the scope before starting a review.",
    );
  }
  const range = `${base}..${tip}`;
  if (git("rev-list", "--merges", range).trim()) {
    throw new Error(
      "Range contains merge commits. Define an explicit review policy for them first.",
    );
  }
  const shas = git("rev-list", "--reverse", range).trim().split("\n").filter(Boolean);
  if (!shas.length) throw new Error("The selected range has no commits to review.");

  const equivalents = new Set(
    git("cherry", base, tip)
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2)),
  );
  const commits = shas.map((sha, index) => ({
    order: index + 1,
    sha,
    parent: revision(`${sha}^`),
    subject: git("show", "-s", "--format=%s", sha).trim(),
    files: git("diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha)
      .split("\0")
      .filter(Boolean),
    patchEquivalentOnBase: equivalents.has(sha),
    pr: null,
    issues: [],
    status: "pending",
    report: `commits/${sha}.md`,
    logs: `logs/${sha}`,
  }));
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    repository,
    base: { ref: baseRef, sha: base },
    tip: { ref: tipRef, sha: tip },
    contextSources: [],
    commits,
    integration: { status: "pending", report: "integration.md" },
    synthesis: { status: "pending", report: "summary.md" },
  };

  const directory = resolve(output);
  // Refuse to overwrite a previous run, including one that is incomplete.
  mkdirSync(resolve(directory, ".."), { recursive: true });
  mkdirSync(directory);
  for (const name of ["commits", "logs", "context"]) mkdirSync(join(directory, name));
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  for (const commit of commits) mkdirSync(join(directory, commit.logs));
  console.log(`${commits.length} commits inventoried in ${join(directory, "manifest.json")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
