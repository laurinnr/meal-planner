import { serve } from "@hono/node-server";
import { type Database, openDatabase } from "@meal-planner/db";
import { createApp } from "./app.ts";
import { type Env, EnvError, parseEnv } from "./env.ts";
import { createLogger } from "./logger.ts";

let env: Env;
try {
  env = parseEnv(process.env);
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  // The logger's own config comes from the environment, so report this plainly.
  console.error(error.message);
  process.exit(1);
}

const logger = createLogger(env.LOG_LEVEL);

let database: Database;
try {
  database = openDatabase(env.DATABASE_PATH, { mustExist: true });
} catch (error) {
  logger.fatal(
    { err: error, databasePath: env.DATABASE_PATH },
    "cannot open the database; run `pnpm db:migrate` to create it",
  );
  process.exit(1);
}

const app = createApp({ database, logger });

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  logger.info({ address: info.address, port: info.port }, "listening");
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
