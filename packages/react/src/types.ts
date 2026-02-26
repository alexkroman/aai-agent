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
  | "websocket_closed"
  | "reconnect_failed";

export interface VoiceAgentError {
  readonly code: VoiceAgentErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface VoiceAgentOptions {
  baseUrl?: string;
  debounceMs?: number;
  autoGreet?: boolean;
  bargeInMinChars?: number;
  enableBargeIn?: boolean;
  maxMessages?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  fetchTimeout?: number;
  onError?: (error: VoiceAgentError) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onBargeIn?: () => void;
  onTurnStart?: (text: string) => void;
  onTurnEnd?: (text: string) => void;
}

export interface VoiceAgentResult {
  readonly messages: readonly Message[];
  readonly error: VoiceAgentError | null;
  readonly phase: Phase;
  readonly turnPhase: TurnPhase;
  readonly toggleRecording: () => void;
  readonly sendMessage: (text: string) => Promise<void>;
  readonly clearMessages: () => void;
}

/** Derive the CSS status class from the current phases. */
export function statusClassOf(phase: Phase, turnPhase: TurnPhase): StatusClass {
  if (phase !== "active") return "";
  return turnPhase;
}

export interface STTHandlers {
  onMessage?: (msg: AAIMessage) => void;
  onUnexpectedClose?: () => void;
}

export interface TTSHandlers {
  onSpeaking?: () => void;
  onDone?: () => void;
}

export interface AAIMessage {
  readonly type: string;
  readonly transcript?: string;
  readonly turn_is_formatted?: boolean;
}

export interface TokensResponse {
  readonly wss_url: string;
  readonly sample_rate: number;
  readonly tts_enabled: boolean;
  readonly tts_sample_rate: number;
}

export interface VoiceDeps {
  readonly baseUrl: string;
  readonly autoGreet: boolean;
  readonly bargeInMinChars: number;
  readonly enableBargeIn: boolean;
  readonly maxMessages: number;
  readonly reconnect: boolean;
  readonly maxReconnectAttempts: number;
  readonly fetchTimeout: number;
  readonly sttConnect: (
    url: string,
    handlers?: STTHandlers,
  ) => Promise<WebSocket>;
  readonly startCapture: (sampleRate: number) => Promise<void>;
  readonly sttDisconnect: () => void;
  readonly sendClear: () => void;
  readonly ttsConnect: (url: string, sampleRate?: number) => Promise<WebSocket>;
  readonly ttsSpeak: (text: string, handlers?: TTSHandlers) => void;
  readonly ttsStop: () => void;
  readonly ttsDisconnect: () => void;
  readonly speakingRef: { current: boolean };
  readonly onError?: (error: VoiceAgentError) => void;
  readonly onConnect?: () => void;
  readonly onDisconnect?: () => void;
  readonly onBargeIn?: () => void;
  readonly onTurnStart?: (text: string) => void;
  readonly onTurnEnd?: (text: string) => void;
}

export type Phase = "idle" | "connecting" | "active";
export type TurnPhase = "listening" | "processing" | "speaking";

export interface VoiceStoreState {
  phase: Phase;
  turnPhase: TurnPhase;
  messages: Message[];
  error: VoiceAgentError | null;
  _setDeps: (deps: VoiceDeps) => void;
  _initDebounce: (ms: number) => void;
  setPhase: (phase: Phase, turnPhase?: TurnPhase) => void;
  addMessage: (
    text: string,
    role: MessageRole,
    type?: MessageType,
  ) => MessageId;
  removeMessage: (id: MessageId) => void;
  clearMessages: () => void;
  bargeIn: () => void;
  sendTurnToAgent: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  handleAAIMessage: (msg: AAIMessage) => void;
  greet: () => Promise<void>;
  reconnectSTT: () => Promise<void>;
  stopRecording: () => void;
  startRecording: () => Promise<void>;
  toggleRecording: () => void;
}

export interface PCMDecodeResult {
  readonly int16: Int16Array;
  readonly sampleCount: number;
}
