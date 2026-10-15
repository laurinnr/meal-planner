import { z } from "zod";

const required = { error: "is required" } as const;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_PATH: z.string(required).min(1, required),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

/** Parses the environment once at boot; throws an EnvError listing every problem. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
