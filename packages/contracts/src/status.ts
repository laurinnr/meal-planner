import { z } from "zod";

/** `GET /status`: what the running API reports about itself, for the SPA to show. */
export const ApiStatus = z.object({
  service: z.literal("meal-planner-api"),
  database: z.enum(["ok", "unavailable"]),
  checkedAt: z.iso.datetime(),
});

export type ApiStatus = z.infer<typeof ApiStatus>;
