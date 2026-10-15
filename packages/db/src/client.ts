import { resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { sql } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

const migrationsFolder = resolve(import.meta.dirname, "../migrations");

export interface OpenOptions {
  /**
   * Fail instead of creating the file when it doesn't exist. The API sets this so
   * a wrong DATABASE_PATH can't quietly start it on an empty, unmigrated file.
   */
  mustExist?: boolean;
}

/**
 * A connection to the app database. The Drizzle handle stays private to this
 * package; callers get narrow methods instead (architecture §4.1).
 */
export class Database {
  readonly #sqlite: BetterSqlite3.Database;
  readonly #db: BetterSQLite3Database<typeof schema>;

  constructor(path: string, options: OpenOptions = {}) {
    this.#sqlite = new BetterSqlite3(path, { fileMustExist: options.mustExist ?? false });
    // Connection settings, not file settings: apply them on every open.
    this.#sqlite.pragma("journal_mode = WAL");
    this.#sqlite.pragma("foreign_keys = ON");
    this.#sqlite.pragma("busy_timeout = 5000");
    this.#sqlite.pragma("synchronous = NORMAL");
    this.#db = drizzle(this.#sqlite, { schema });
  }

  /** Throws unless the database can be queried. Backs the API's `/ready`. */
  ping(): void {
    this.#db.get(sql`select 1`);
  }

  /**
   * Applies pending migrations and returns how many ran. Only the `db:migrate`
   * command and tests call this; the API never migrates on boot (§8.4).
   */
  migrate(): number {
    const before = this.#appliedMigrations();
    migrate(this.#db, { migrationsFolder });
    return this.#appliedMigrations() - before;
  }

  close(): void {
    this.#sqlite.close();
  }

  #appliedMigrations(): number {
    const table = this.#sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
      .get();
    if (table === undefined) return 0;
    return this.#sqlite
      .prepare("select count(*) from __drizzle_migrations")
      .pluck()
      .get() as number;
  }
}

export function openDatabase(path: string, options?: OpenOptions): Database {
  return new Database(path, options);
}
