import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "./client.ts";

describe("Database snapshots", () => {
  let dir: string;
  const opened: Array<Database | BetterSqlite3.Database> = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "meal-planner-db-"));
  });

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function source() {
    const path = join(dir, "live.db");
    const database = openDatabase(path);
    opened.push(database);
    database.migrate();
    const writer = new BetterSqlite3(path);
    opened.push(writer);
    writer.prepare("insert into households (id, name) values (?, ?)").run("h1", "Before backup");
    return { database, writer };
  }

  function inspect(path: string) {
    const database = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
    opened.push(database);
    return database;
  }

  it("restores committed contents from a live WAL database at the snapshot time", () => {
    const { database, writer } = source();
    writer.exec("begin");
    writer.prepare("update households set name = ? where id = ?").run("Uncommitted", "h1");
    const snapshot = join(dir, "snapshot.db");
    database.snapshot(snapshot);
    writer.exec("rollback");
    writer.prepare("update households set name = ? where id = ?").run("After backup", "h1");

    const restored = join(dir, "restored.db");
    copyFileSync(snapshot, restored);
    const recovered = inspect(restored);
    expect(recovered.prepare("select id, name from households").all()).toEqual([
      { id: "h1", name: "Before backup" },
    ]);
    expect(recovered.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(recovered.pragma("foreign_key_check")).toEqual([]);
    expect(writer.prepare("select name from households where id = ?").pluck().get("h1")).toBe(
      "After backup",
    );
  });

  it("preserves an existing snapshot when another snapshot targets the same path", () => {
    const { database, writer } = source();
    const snapshot = join(dir, "snapshot.db");
    database.snapshot(snapshot);
    writer.exec("delete from households");
    expect(() => database.snapshot(snapshot)).toThrow();
    expect(inspect(snapshot).prepare("select name from households").pluck().all()).toEqual([
      "Before backup",
    ]);
  });
});
