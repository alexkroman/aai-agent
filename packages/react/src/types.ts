export interface Message {
  readonly id: string;
  readonly text: string;
  readonly role: "user" | "assistant";
  readonly type: "message" | "thinking";
}

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

export type Phase = "idle" | "connecting" | "active";
export type TurnPhase = "listening" | "processing" | "speaking";
