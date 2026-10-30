import { openDatabase } from "@meal-planner/db";
import { EnvError, parseEnv } from "./env.ts";

// The one-shot migrate step of a deployment (docs/architecture.md §8.4). The API itself
// never migrates on boot. Locally, `pnpm db:migrate` does the same job.
try {
  const { DATABASE_PATH } = parseEnv(process.env);
  const database = openDatabase(DATABASE_PATH);
  try {
    const applied = database.migrate();
    console.log(
      `${DATABASE_PATH}: ${applied === 0 ? "up to date" : `applied ${applied} migration(s)`}`,
    );
  } finally {
    database.close();
  }
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}
