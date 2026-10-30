import { ApiStatus } from "@meal-planner/contracts";
import type { Database } from "@meal-planner/db";
import { createTestDatabase } from "@meal-planner/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createLogger } from "./logger.ts";

describe("api", () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    database = createTestDatabase();
    app = createApp({ database, logger: createLogger("silent") });
  });

  afterAll(() => database.close());

  it("GET /health reports the process is alive", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("GET /ready queries the migrated database", async () => {
    const response = await app.request("/ready");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("GET /status matches the contract", async () => {
    const response = await app.request("/status");
    expect(response.status).toBe(200);
    const status = ApiStatus.parse(await response.json());
    expect(status.database).toBe("ok");
  });

  it("GET /ready reports a database that cannot be queried", async () => {
    const closed = createTestDatabase();
    closed.close();
    const broken = createApp({ database: closed, logger: createLogger("silent") });
    const response = await broken.request("/ready");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
