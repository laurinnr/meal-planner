import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./client.ts";

// Exercise the exact recovery block operators copy, with Docker replaced by a local
// adapter. SQLite, filesystem operations, shell error handling and Node are real.
const runbook = readFileSync(new URL("../../../docs/deploy.md", import.meta.url), "utf8");
const matchedCommand = runbook.match(/<!-- restore-command -->\n```sh\n([\s\S]*?)\n```/)?.[1];
if (matchedCommand === undefined)
  throw new Error("Missing tested restore command in docs/deploy.md");
const command: string = matchedCommand;
const databasePackage = fileURLToPath(new URL("..", import.meta.url));

describe("documented recovery", () => {
  let dir: string;
  let live: string;
  let backup: string;
  let log: string;
  let original: Buffer;

  function populate(path: string, name: string) {
    const database = openDatabase(path);
    database.migrate();
    database.close();
    const sqlite = new BetterSqlite3(path);
    try {
      sqlite.prepare("insert into households (id, name) values (?, ?)").run("h1", name);
    } finally {
      sqlite.close();
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "meal-planner-restore-"));
    live = join(dir, "app.db");
    backup = join(dir, "backup.db");
    log = join(dir, "docker.log");
    populate(live, "Newer live data");
    populate(backup, "Historical backup");
    original = readFileSync(live);
    // Recovery must preserve even unreadable originals and their sidecars. The
    // replacement is validated independently before anything original is removed.
    writeFileSync(`${live}-wal`, "original WAL recovery bytes");
    writeFileSync(`${live}-shm`, "original SHM recovery bytes");
    writeFileSync(log, "");
    writeFileSync(
      join(dir, "docker"),
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.RESTORE_TEST_LOG, args.join(' ') + '\\n');
const nodeIndex = args.indexOf('--input-type=module');
if (nodeIndex !== -1) {
  const forwarded = args.slice(nodeIndex).map(arg =>
    arg === '/data' ? process.env.RESTORE_TEST_DIR :
    arg.startsWith('/snapshots/') ? join(process.env.RESTORE_TEST_DIR, arg.slice(11)) : arg);
  const result = spawnSync(process.execPath, forwarded, {
    cwd: process.env.RESTORE_PACKAGE, stdio: 'inherit'
  });
  process.exit(result.status ?? 1);
}
if (args.at(-1) === 'migrate' && process.env.RESTORE_MIGRATE_FAIL === '1') process.exit(1);
`,
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function recover(extra: NodeJS.ProcessEnv = {}) {
    return spawnSync("sh", ["-c", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        RESTORE_FILE: "backup.db",
        RESTORE_TEST_DIR: dir,
        RESTORE_TEST_LOG: log,
        RESTORE_PACKAGE: databasePackage,
        ...extra,
      },
    });
  }

  function preservedDirectory() {
    const name = readdirSync(dir).find((entry) => entry.startsWith("before-restore-"));
    if (name === undefined) throw new Error("Original recovery files were not preserved");
    return join(dir, name);
  }

  it("restores historical contents, preserves all original files, then starts", () => {
    const result = recover();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const preserved = preservedDirectory();
    expect(readFileSync(join(preserved, "app.db"))).toEqual(original);
    expect(readFileSync(join(preserved, "app.db-wal"), "utf8")).toBe("original WAL recovery bytes");
    expect(readFileSync(join(preserved, "app.db-shm"), "utf8")).toBe("original SHM recovery bytes");
    const restored = new BetterSqlite3(live, { readonly: true, fileMustExist: true });
    try {
      expect(restored.prepare("select name from households").pluck().all()).toEqual([
        "Historical backup",
      ]);
      expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      restored.close();
    }
    expect(readFileSync(log, "utf8")).toMatch(/migrate\ncompose up -d\n$/);
  });

  it.each(["missing", "corrupt", "empty"])(
    "stops on a %s backup and leaves originals intact",
    (kind) => {
      if (kind === "missing") rmSync(backup);
      else writeFileSync(backup, kind === "corrupt" ? "not a SQLite database" : "");
      const result = recover();
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(readFileSync(live)).toEqual(original);
      expect(readFileSync(`${live}-wal`, "utf8")).toBe("original WAL recovery bytes");
      expect(readFileSync(`${live}-shm`, "utf8")).toBe("original SHM recovery bytes");
      expect(readFileSync(log, "utf8")).not.toMatch(/migrate|compose up/);
    },
  );

  it("keeps the original and prevents startup when migration fails", () => {
    const result = recover({ RESTORE_MIGRATE_FAIL: "1" });
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(preservedDirectory(), "app.db"))).toEqual(original);
    expect(readFileSync(log, "utf8")).toContain("migrate");
    expect(readFileSync(log, "utf8")).not.toContain("compose up");
  });
});
