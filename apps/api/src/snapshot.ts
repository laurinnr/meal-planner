import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { openDatabase } from "@meal-planner/db";
import { EnvError, parseEnv } from "./env.ts";

// Writes a timestamped VACUUM INTO copy of the database into a directory and keeps the
// newest few for the daily backup. Safe to run while the API is up.
//
//   node dist/app/snapshot.js <directory> [<copies to keep, default 14>]

const [directory, keepArgument = "14"] = process.argv.slice(2);
const keep = Number(keepArgument);
if (directory === undefined || !Number.isInteger(keep) || keep < 1) {
  console.error("usage: node dist/app/snapshot.js <directory> [<copies to keep>]");
  process.exit(2);
}

let databasePath: string;
try {
  databasePath = parseEnv(process.env).DATABASE_PATH;
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}

// e.g. app-20261030T182700Z.db, which sorts by time.
const snapshotName = /^app-\d{8}T\d{6}Z\.db$/;
const name = `app-${new Date().toISOString().replace(/[-:]|\.\d+/g, "")}.db`;
// Written under a name that doesn't match, then renamed, so a backup that runs
// mid-write never picks up a partial file.
const partial = join(directory, `.${name}.partial`);

await rm(partial, { force: true });
const database = openDatabase(databasePath, { mustExist: true });
try {
  database.snapshot(partial);
} finally {
  database.close();
}
await rename(partial, join(directory, name));
console.log(`wrote ${join(directory, name)}`);

const old = (await readdir(directory))
  .filter((file) => snapshotName.test(file))
  .sort()
  .reverse()
  .slice(keep);
for (const file of old) {
  await rm(join(directory, file));
  console.log(`removed ${join(directory, file)}`);
}
