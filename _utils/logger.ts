import {
  ConsoleHandler,
  getLogger as stdGetLogger,
  type Logger,
  setup,
} from "@std/log";

export type { Logger };

const VALID_LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"]);
const raw = (Deno.env.get("LOG_LEVEL") ?? "INFO").toUpperCase();
const level = VALID_LEVELS.has(raw)
  ? (raw as "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL")
  : "INFO";

setup({
  handlers: { default: new ConsoleHandler(level) },
  loggers: { default: { level, handlers: ["default"] } },
});

export function getLogger(name: string): Logger {
  return stdGetLogger(name);
}
