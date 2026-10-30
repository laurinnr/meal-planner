import type { AppType } from "@meal-planner/api";
import { hc } from "hono/client";

/** Typed client for the API, which is served same-origin under /api. */
export const api = hc<AppType>("/api");
