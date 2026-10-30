import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import { createTestDatabase } from "./testing.ts";

describe("createTestDatabase", () => {
  const opened: Database[] = [];
  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  it("applies every migration", () => {
    const database = createTestDatabase();
    opened.push(database);
    expect(() => database.ping()).not.toThrow();
    expect(database.migrate()).toBe(0);
  });
});
