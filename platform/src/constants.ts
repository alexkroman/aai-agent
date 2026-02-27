// constants.ts — Centralized constants for message types, timeouts, paths, and sample rates.

/** WebSocket message types sent between server and browser. */
export const MSG = {
  // Server → Browser
  READY: "ready",
  GREETING: "greeting",
  TRANSCRIPT: "transcript",
  TURN: "turn",
  THINKING: "thinking",
  CHAT: "chat",
  TTS_DONE: "tts_done",
  CANCELLED: "cancelled",
  ERROR: "error",
  RESET: "reset",

  // Browser → Server
  CONFIGURE: "configure",
  CANCEL: "cancel",
} as const;

/** Timeout values in milliseconds. */
export const TIMEOUTS = {
  /** STT WebSocket connection timeout */
  STT_CONNECTION: 10_000,
  /** Tool handler execution timeout in the V8 sandbox */
  TOOL_HANDLER: 30_000,
  /** STT token validity period in seconds */
  STT_TOKEN_EXPIRES: 480,
} as const;

/** HTTP and WebSocket paths. */
export const PATHS = {
  WEBSOCKET: "/session",
  HEALTH: "/health",
  CLIENT_JS: "/client.js",
  REACT_JS: "/react.js",
} as const;

/** Audio sample rates in Hz. */
export const SAMPLE_RATES = {
  STT: 16_000,
  TTS: 24_000,
} as const;

/** V8 isolate memory limit in MB. */
export const ISOLATE_MEMORY_LIMIT_MB = 128;

/** Maximum LLM tool-call iterations per turn. */
export const MAX_TOOL_ITERATIONS = 3;
