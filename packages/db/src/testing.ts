import { type Database, openDatabase } from "./client.ts";

/**
 * A fresh in-memory database with every migration applied. Call it once per test
 * file (or per test) and close it afterwards; nothing is shared between calls.
 */
export function createTestDatabase(): Database {
  const database = openDatabase(":memory:");
  database.migrate();
  return database;
}
