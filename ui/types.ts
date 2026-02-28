// types.ts — Shared types, constants, and pure utility functions for the client.

// ── Named constants (replace magic numbers) ────────────────────

export const PING_INTERVAL_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const MAX_BACKOFF_MS = 16_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MIC_BUFFER_SECONDS = 0.1;

// ── State machine ──────────────────────────────────────────────

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** Valid state transitions. Each key maps to the set of states it can transition to. */
export const VALID_TRANSITIONS: Record<AgentState, Set<AgentState>> = {
  connecting: new Set(["ready", "error"]),
  ready: new Set(["listening", "error", "connecting"]),
  listening: new Set(["thinking", "speaking", "error", "connecting"]),
  thinking: new Set(["speaking", "listening", "error", "connecting"]),
  speaking: new Set(["listening", "thinking", "error", "connecting"]),
  error: new Set(["connecting", "ready"]),
};

// ── Data types ─────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
}

export interface AgentOptions {
  /** Platform URL to connect to. Defaults to window.location.origin. */
  platformUrl?: string;
}
