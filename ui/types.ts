export const PING_INTERVAL_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const MAX_BACKOFF_MS = 16_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MIC_BUFFER_SECONDS = 0.1;

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export const VALID_TRANSITIONS: Record<AgentState, Set<AgentState>> = {
  connecting: new Set(["ready", "error"]),
  ready: new Set(["listening", "error", "connecting"]),
  listening: new Set(["thinking", "speaking", "error", "connecting"]),
  thinking: new Set(["speaking", "listening", "error", "connecting"]),
  speaking: new Set(["listening", "thinking", "error", "connecting"]),
  error: new Set(["connecting", "ready"]),
};

export interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
}

export interface AgentOptions {
  platformUrl?: string;
}
