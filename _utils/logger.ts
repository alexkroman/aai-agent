import { ConsoleHandler, getLogger, type Logger, setup } from "@std/log";

export type { Logger };

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";
const VALID_LEVELS = new Set<LogLevel>([
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "CRITICAL",
]);
const raw = (Deno.env.get("LOG_LEVEL") ?? "INFO").toUpperCase();
const level: LogLevel = VALID_LEVELS.has(raw as LogLevel)
  ? raw as LogLevel
  : "INFO";

setup({
  handlers: { default: new ConsoleHandler(level) },
  loggers: { default: { level, handlers: ["default"] } },
});

export { getLogger };
