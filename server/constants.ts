// constants.ts — Centralized magic strings and numbers.

/** WebSocket message type strings — re-exported from shared-protocol.ts. */
export { MSG } from "./shared-protocol.js";

/** Timeout durations in milliseconds. */
export const TIMEOUTS = {
  /** STT WebSocket connection timeout */
  STT_CONNECTION: 10_000,
  /** Tool handler execution timeout */
  TOOL_HANDLER: 30_000,
  /** STT token expiration in seconds */
  STT_TOKEN_EXPIRES: 480,
} as const;

/** HTTP/WebSocket path constants. */
export const PATHS = {
  WEBSOCKET: "/session",
  HEALTH: "/health",
  CLIENT_JS: "/client.js",
} as const;

/** Audio sample rates. */
export const SAMPLE_RATES = {
  STT: 16_000,
  TTS: 24_000,
} as const;

/** V8 isolate memory limit per session. */
export const ISOLATE_MEMORY_LIMIT_MB = 128;

/** Maximum LLM tool-call iterations per turn. */
export const MAX_TOOL_ITERATIONS = 3;
