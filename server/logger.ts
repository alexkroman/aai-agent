// logger.ts — Deno-native structured logging (replaces pino).

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel =
  (Deno.env.get("LOG_LEVEL") as LogLevel | undefined) ?? "info";
const threshold = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;
const isDev = Deno.env.get("DENO_ENV") !== "production";

export interface Logger {
  debug(data: Record<string, unknown>, msg?: string): void;
  info(data: Record<string, unknown>, msg?: string): void;
  warn(data: Record<string, unknown>, msg?: string): void;
  error(data: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(name: string, meta?: Record<string, string>): Logger {
  const base = { name, ...meta };

  function log(level: LogLevel, args: [Record<string, unknown>, string?] | [string]) {
    if (LOG_LEVELS[level] < threshold) return;

    const data = typeof args[0] === "string"
      ? { ...base, msg: args[0] }
      : { ...base, ...args[0], msg: args[1] ?? "" };

    if (isDev) {
      const ts = new Date().toISOString().slice(11, 23);
      const msg = data.msg || "";
      const rest = { ...data };
      delete rest.name;
      delete rest.msg;
      const extra = Object.keys(rest).length
        ? " " + JSON.stringify(rest)
        : "";
      console.log(`${ts} [${level.toUpperCase()}] ${name}: ${msg}${extra}`);
    } else {
      console.log(JSON.stringify({ level, ts: Date.now(), ...data }));
    }
  }

  return {
    debug(...args: [Record<string, unknown>, string?] | [string]) {
      log("debug", args as [Record<string, unknown>, string?] | [string]);
    },
    info(...args: [Record<string, unknown>, string?] | [string]) {
      log("info", args as [Record<string, unknown>, string?] | [string]);
    },
    warn(...args: [Record<string, unknown>, string?] | [string]) {
      log("warn", args as [Record<string, unknown>, string?] | [string]);
    },
    error(...args: [Record<string, unknown>, string?] | [string]) {
      log("error", args as [Record<string, unknown>, string?] | [string]);
    },
  };
}
