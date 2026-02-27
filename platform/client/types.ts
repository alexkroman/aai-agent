// types.ts — Shared types, constants, and pure utility functions for the client.

// ── Named constants (replace magic numbers) ────────────────────

export const PING_INTERVAL_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const MAX_BACKOFF_MS = 16_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MIC_BUFFER_SECONDS = 0.1;
export const DEFAULT_VOICE = "jess";

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

export interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  handler: (...args: any[]) => Promise<unknown>;
}

export interface AgentOptions {
  apiKey: string;
  platformUrl?: string;
  instructions?: string;
  greeting?: string;
  voice?: string;
  prompt?: string;
  tools?: Record<string, ToolDef>;
}

// ── Tool context (for typing handler arguments) ───────────────

/** Context object passed to every tool handler in the V8 sandbox. */
export interface ToolContext {
  secrets: Record<string, string>;
  fetch: (
    url: string,
    init?: RequestInit
  ) => {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: () => string;
    json: () => unknown;
  };
}

// ── URL helpers ───────────────────────────────────────────────

/** Convert an HTTP(S) URL to WS(S). Pass-through if already ws(s). */
export function toWebSocketUrl(url: string): string {
  if (url.startsWith("wss://") || url.startsWith("ws://")) return url;
  if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
  if (url.startsWith("http://")) return "ws://" + url.slice("http://".length);
  return url;
}

// ── Tool serialization ─────────────────────────────────────────

export function serializeTools(
  tools: Record<string, ToolDef>
): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: string;
}[] {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    parameters: t.parameters,
    handler: t.handler.toString(),
  }));
}
