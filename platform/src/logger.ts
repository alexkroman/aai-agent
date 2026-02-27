// logger.ts — Structured JSON logging via pino.

import pino from "pino";

/**
 * Create a structured logger with a component name and optional metadata.
 *
 * In production: JSON output (default pino).
 * In development: set LOG_LEVEL=debug for verbose output.
 */
export function createLogger(name: string, meta?: Record<string, string>): pino.Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    ...(meta ? { base: { ...meta } } : { base: undefined }),
  });
}

export type Logger = pino.Logger;
