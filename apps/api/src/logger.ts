import { type Logger, pino } from "pino";
import type { Env } from "./env.ts";

export type { Logger };

export function createLogger(level: Env["LOG_LEVEL"]): Logger {
  return pino({ level });
}
