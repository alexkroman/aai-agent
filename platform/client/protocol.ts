// protocol.ts — Client-side protocol types for the WebSocket protocol.
// Re-exports from the shared protocol — single source of truth.

import { MSG } from "../src/shared-protocol.js";
import type {
  ReadyMessage,
  GreetingMessage,
  TranscriptMessage,
  TurnMessage,
  ThinkingMessage,
  ChatResponseMessage as ChatMessage,
  TtsDoneMessage,
  CancelledMessage,
  ResetMessage,
  ErrorMessage,
  PongMessage,
  ServerMessage as SharedServerMessage,
  AuthenticateMessage,
  ConfigureMessage,
  CancelMessage,
  ResetClientMessage,
  PingMessage,
  ClientMessage,
} from "../src/shared-protocol.js";

/** @deprecated Use MSG directly — CLIENT_MSG is an alias for backward compatibility. */
export const CLIENT_MSG = MSG;

// Re-export all message types for client consumers
export type {
  ReadyMessage,
  GreetingMessage,
  TranscriptMessage,
  TurnMessage,
  ThinkingMessage,
  ChatMessage,
  TtsDoneMessage,
  CancelledMessage,
  ResetMessage,
  ErrorMessage,
  PongMessage,
  AuthenticateMessage,
  ConfigureMessage,
  CancelMessage,
  ResetClientMessage,
  PingMessage,
  ClientMessage,
};

/** Discriminated union of all server -> browser messages. */
export type ServerMessage = SharedServerMessage | PongMessage;

// ── Parser ───────────────────────────────────────────────────────

const KNOWN_SERVER_TYPES = new Set<string>([
  MSG.READY,
  MSG.GREETING,
  MSG.TRANSCRIPT,
  MSG.TURN,
  MSG.THINKING,
  MSG.CHAT,
  MSG.TTS_DONE,
  MSG.CANCELLED,
  MSG.ERROR,
  MSG.RESET,
  MSG.PONG,
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
