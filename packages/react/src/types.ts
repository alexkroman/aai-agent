declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Opaque identifier for messages — only created by `addMessage`. */
export type MessageId = Brand<string, "MessageId">;

/** Create a MessageId from a plain string (useful in tests). */
export function createMessageId(s: string = crypto.randomUUID()): MessageId {
  return s as MessageId;
}

export interface Message {
  readonly id: MessageId;
  readonly text: string;
  readonly role: "user" | "assistant";
  readonly type: "message" | "thinking";
}

export type MessageRole = Message["role"];
export type MessageType = Message["type"];
export type StatusClass = "listening" | "processing" | "speaking" | "";

export type VoiceAgentErrorCode =
  | "mic_denied"
  | "connection_failed"
  | "chat_error"
  | "websocket_closed";

export interface VoiceAgentError {
  readonly code: VoiceAgentErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface VoiceAgentOptions {
  baseUrl?: string;
  maxMessages?: number;
  onError?: (error: VoiceAgentError) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onTurnStart?: (text: string) => void;
  onTurnEnd?: (text: string) => void;
}

export interface VoiceAgentResult {
  readonly messages: readonly Message[];
  readonly error: VoiceAgentError | null;
  readonly phase: Phase;
  readonly turnPhase: TurnPhase;
  readonly toggleRecording: () => void;
  readonly clearMessages: () => void;
}

/** Derive the CSS status class from the current phases. */
export function statusClassOf(phase: Phase, turnPhase: TurnPhase): StatusClass {
  if (phase !== "active") return "";
  return turnPhase;
}

export type Phase = "idle" | "connecting" | "active";
export type TurnPhase = "listening" | "processing" | "speaking";

export interface PCMDecodeResult {
  readonly int16: Int16Array;
  readonly sampleCount: number;
}
