import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase } from "../client.ts";

// Local development defaults to <repo>/data; deployments set DATABASE_PATH.
const path =
  process.env.DATABASE_PATH ?? resolve(import.meta.dirname, "../../../../data/meal-planner.db");

mkdirSync(dirname(path), { recursive: true });
const database = openDatabase(path);
try {
  const applied = database.migrate();
  console.log(applied === 0 ? `${path}: up to date` : `${path}: applied ${applied} migration(s)`);
} finally {
  database.close();
}
