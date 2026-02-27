// protocol.ts — Client-side protocol types for the WebSocket protocol.
// Keep in sync with src/types.ts and src/constants.ts on the server.

/** WebSocket message type strings (mirrors server MSG from src/constants.ts). */
export const CLIENT_MSG = {
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

export interface ReadyMessage {
  type: "ready";
  sampleRate: number;
  ttsSampleRate: number;
}

export interface GreetingMessage {
  type: "greeting";
  text: string;
}

export interface TranscriptMessage {
  type: "transcript";
  text: string;
}

export interface TurnMessage {
  type: "turn";
  text: string;
}

export interface ThinkingMessage {
  type: "thinking";
}

export interface ChatMessage {
  type: "chat";
  text: string;
  steps: string[];
}

export interface TtsDoneMessage {
  type: "tts_done";
}

export interface CancelledMessage {
  type: "cancelled";
}

export interface ResetMessage {
  type: "reset";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

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
  | ChatMessage
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

// ── Parser ───────────────────────────────────────────────────────

const KNOWN_SERVER_TYPES = new Set<string>([
  CLIENT_MSG.READY,
  CLIENT_MSG.GREETING,
  CLIENT_MSG.TRANSCRIPT,
  CLIENT_MSG.TURN,
  CLIENT_MSG.THINKING,
  CLIENT_MSG.CHAT,
  CLIENT_MSG.TTS_DONE,
  CLIENT_MSG.CANCELLED,
  CLIENT_MSG.ERROR,
  CLIENT_MSG.RESET,
  CLIENT_MSG.PONG,
]);

/** Parse a raw JSON string into a typed ServerMessage, or null if malformed/unknown. */
export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data);
    if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") {
      return null;
    }
    if (!KNOWN_SERVER_TYPES.has(msg.type)) {
      return null;
    }
    return msg as ServerMessage;
  } catch {
    return null;
  }
}
