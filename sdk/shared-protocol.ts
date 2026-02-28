// shared-protocol.ts — Single source of truth for the WebSocket protocol.
// Imported by both sdk/ and ui/ code.

/** WebSocket message type strings (browser <-> server protocol). */
export const MSG = {
  // Server -> browser
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
  PONG: "pong",

  // Browser -> server
  AUDIO_READY: "audio_ready",
  CANCEL: "cancel",
  PING: "ping",
} as const;

/** Timeout durations in milliseconds. */
export const TIMEOUTS = {
  /** STT WebSocket connection timeout */
  STT_CONNECTION: 10_000,
  /** Tool handler execution timeout */
  TOOL_HANDLER: 30_000,
  /** STT token expiration in seconds */
  STT_TOKEN_EXPIRES: 480,
} as const;

/** Maximum LLM tool-call iterations per turn. */
export const MAX_TOOL_ITERATIONS = 3;

// ── Server -> Browser message interfaces ─────────────────────────

/** Server tells browser STT is ready; includes sample rates. */
export interface ReadyMessage {
  type: "ready";
  sampleRate: number;
  ttsSampleRate: number;
  version?: number;
}

/** Server sends the initial greeting text. */
export interface GreetingMessage {
  type: "greeting";
  text: string;
}

/** Real-time speech transcript (partial or final). */
export interface TranscriptMessage {
  type: "transcript";
  text: string;
  final: boolean;
}

/** A completed user turn (speech finalized). */
export interface TurnMessage {
  type: "turn";
  text: string;
}

/** Server is processing (LLM thinking). */
export interface ThinkingMessage {
  type: "thinking";
}

/** LLM response with optional tool-use steps. */
export interface ChatResponseMessage {
  type: "chat";
  text: string;
  steps: string[];
}

/** TTS audio playback is complete. */
export interface TtsDoneMessage {
  type: "tts_done";
}

/** Cancel acknowledged. */
export interface CancelledMessage {
  type: "cancelled";
}

/** Conversation reset acknowledged. */
export interface ResetMessage {
  type: "reset";
}

/** Error message from the server. */
export interface ErrorMessage {
  type: "error";
  message: string;
  details?: string[];
}

/** Pong response to client ping. */
export interface PongMessage {
  type: "pong";
}

/** Discriminated union of all server -> browser messages. */
export type ServerMessage =
  | ReadyMessage
  | GreetingMessage
  | TranscriptMessage
  | TurnMessage
  | ThinkingMessage
  | ChatResponseMessage
  | TtsDoneMessage
  | CancelledMessage
  | ResetMessage
  | ErrorMessage
  | PongMessage;

// ── Browser -> Server message interfaces ─────────────────────────

export interface AudioReadyMessage {
  type: "audio_ready";
}

export interface CancelMessage {
  type: "cancel";
}

export interface ResetClientMessage {
  type: "reset";
}

export interface PingMessage {
  type: "ping";
}

/** Discriminated union of all browser -> server messages. */
export type ClientMessage =
  | AudioReadyMessage
  | CancelMessage
  | ResetClientMessage
  | PingMessage;
