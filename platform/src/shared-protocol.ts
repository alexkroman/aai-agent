// shared-protocol.ts — Single source of truth for the WebSocket protocol.
// Imported by both server (src/) and client (client/) code.
// esbuild inlines this at build time — no runtime dependency change.

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
  AUTHENTICATE: "authenticate",
  CONFIGURE: "configure",
  CANCEL: "cancel",
  PING: "ping",
} as const;

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

export interface AuthenticateMessage {
  type: "authenticate";
  apiKey: string;
}

export interface ConfigureMessage {
  type: "configure";
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  tools: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: string;
  }[];
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
  | AuthenticateMessage
  | ConfigureMessage
  | CancelMessage
  | ResetClientMessage
  | PingMessage;
