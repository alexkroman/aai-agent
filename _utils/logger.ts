import {
  ConsoleHandler,
  getLogger as _getLogger,
  type Logger,
  setup,
} from "@std/log";

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

const handler = new ConsoleHandler(level, {
  formatter: ({ loggerName, levelName, msg, args }) => {
    const base = `${levelName} [${loggerName}] ${msg}`;
    if (args.length === 0) return base;
    const meta = args.length === 1 ? args[0] : args;
    try {
      return `${base} ${JSON.stringify(meta)}`;
    } catch {
      return `${base} ${String(meta)}`;
    }
  },
});

// Track configured loggers so we can register them on first use.
const configured = new Set<string>(["default"]);
setup({
  handlers: { default: handler },
  loggers: { default: { level, handlers: ["default"] } },
});

/** Returns a named logger that inherits the global log level. */
export function getLogger(name?: string): Logger {
  if (name && !configured.has(name)) {
    configured.add(name);
    setup({
      handlers: { default: handler },
      loggers: {
        ...Object.fromEntries(
          [...configured].map((n) => [n, { level, handlers: ["default"] }]),
        ),
      },
    });
  }
  return _getLogger(name);
}
