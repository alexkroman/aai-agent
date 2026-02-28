// WebSocket wire-format types shared by server/ and ui/.

export interface ReadyMessage {
  type: "ready";
  sampleRate: number;
  ttsSampleRate: number;
  version?: number;
}

export interface GreetingMessage {
  type: "greeting";
  text: string;
}

export interface TranscriptMessage {
  type: "transcript";
  text: string;
  final: boolean;
}

export interface TurnMessage {
  type: "turn";
  text: string;
}

export interface ThinkingMessage {
  type: "thinking";
}

export interface ChatResponseMessage {
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
  details?: string[];
}

export interface PongMessage {
  type: "pong";
}

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

export type ClientMessage =
  | AudioReadyMessage
  | CancelMessage
  | ResetClientMessage
  | PingMessage;
