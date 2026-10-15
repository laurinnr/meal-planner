import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Database } from "@meal-planner/db";
import type { Logger } from "./logger.ts";

export interface AppDependencies {
  database: Database;
  logger: Logger;
}

const health = createRoute({
  method: "get",
  path: "/health",
  summary: "The process is alive",
  responses: {
    200: {
      description: "Alive",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

const ready = createRoute({
  method: "get",
  path: "/ready",
  summary: "The database can be opened and queried",
  responses: {
    200: {
      description: "Ready to serve requests",
      content: { "application/json": { schema: z.object({ status: z.literal("ready") }) } },
    },
    503: {
      description: "The database cannot be queried",
      content: { "application/json": { schema: z.object({ status: z.literal("unavailable") }) } },
    },
  },
});

// Probes run every few seconds; keep them out of the info-level request log.
const probePaths = new Set(["/health", "/ready"]);

export function createApp({ database, logger }: AppDependencies) {
  const app = new OpenAPIHono();

  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    const level = probePaths.has(c.req.path) && c.res.ok ? "debug" : "info";
    logger[level](
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      },
      "request",
    );
  });

  app.onError((error, c) => {
    logger.error({ err: error, method: c.req.method, path: c.req.path }, "unhandled error");
    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Meal Planner API", version: "0.0.0" },
  });

  return app
    .openapi(health, (c) => c.json({ status: "ok" } as const, 200))
    .openapi(ready, (c) => {
      try {
        database.ping();
        return c.json({ status: "ready" } as const, 200);
      } catch (error) {
        logger.warn({ err: error }, "readiness check failed");
        return c.json({ status: "unavailable" } as const, 503);
      }
    });
}

/** The route tree, for the web app's typed `hc<AppType>()` client. */
export type AppType = ReturnType<typeof createApp>;
