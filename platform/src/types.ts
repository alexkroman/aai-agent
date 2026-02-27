// types.ts — All TypeScript interfaces and message types.

import { z } from "zod";

// ── STT Configuration ──────────────────────────────────────────────

/** Configuration for the AssemblyAI Streaming STT WebSocket. */
export interface STTConfig {
  /** Audio sample rate in Hz (e.g., 16000) */
  sampleRate: number;
  /** AssemblyAI speech model identifier (e.g., "u3-pro") */
  speechModel: string;
  /** Base WebSocket URL for AssemblyAI Streaming v3 */
  wssBase: string;
  /** Ephemeral token validity period in seconds */
  tokenExpiresIn: number;
  /** Whether to request formatted turn transcripts */
  formatTurns: boolean;
  /** Minimum silence (ms) before ending a turn when confidence is high */
  minEndOfTurnSilenceWhenConfident: number;
  /** Maximum silence (ms) before forcing end-of-turn */
  maxTurnSilence: number;
}

export const DEFAULT_STT_CONFIG: STTConfig = {
  sampleRate: 16_000,
  speechModel: "u3-pro",
  wssBase: "wss://streaming.assemblyai.com/v3/ws",
  tokenExpiresIn: 480,
  formatTurns: true,
  minEndOfTurnSilenceWhenConfident: 400,
  maxTurnSilence: 1200,
};

// ── TTS Configuration ──────────────────────────────────────────────

/** Configuration for the Baseten Orpheus TTS WebSocket. */
export interface TTSConfig {
  /** WebSocket URL for the Orpheus TTS model on Baseten */
  wssUrl: string;
  /** Baseten API key for authentication */
  apiKey: string;
  /** Voice name (e.g., "jess", "tara", "luna") */
  voice: string;
  /** Maximum tokens to generate per synthesis */
  maxTokens: number;
  /** Number of words to buffer before streaming audio */
  bufferSize: number;
  /** Penalty for repeated tokens (1.0 = no penalty) */
  repetitionPenalty: number;
  /** Sampling temperature (0.0 = deterministic, 1.0 = creative) */
  temperature: number;
  /** Nucleus sampling threshold */
  topP: number;
  /** Audio output sample rate in Hz */
  sampleRate: number;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  wssUrl: "wss://model-q844y7pw.api.baseten.co/environments/production/websocket",
  apiKey: "",
  voice: "jess",
  maxTokens: 2000,
  bufferSize: 105,
  repetitionPenalty: 1.2,
  temperature: 0.6,
  topP: 0.9,
  sampleRate: 24_000,
};

// ── LLM Configuration ──────────────────────────────────────────────

/** Base URL for the AssemblyAI LLM Gateway (OpenAI-compatible). */
export const LLM_GATEWAY_BASE = "https://llm-gateway.assemblyai.com/v1";

/** Default LLM model identifier. */
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** Default system instructions for the voice assistant. */
export const DEFAULT_INSTRUCTIONS = `\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing.`;

/** Appended to system instructions to enforce voice-friendly output. */
export const VOICE_RULES =
  "\n\nCRITICAL: When you produce your final answer, it will be spoken aloud by a TTS system. " +
  "Write your answer exactly as you would say it out loud to a friend. " +
  "One to two sentences max. No markdown, no bullet points, no numbered lists, no code. " +
  "Sound like a human talking, not a document.";

/** Default greeting spoken when a session starts. */
export const DEFAULT_GREETING = "Hey there! I'm a voice assistant. What can I help you with?";

// ── Tool Definition (from customer configure message) ──────────────

/** A tool defined by the customer in their configure message. */
export interface ToolDef {
  /** Tool name (used by the LLM to invoke it) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Parameter schema (simple, extended, or raw JSON Schema) */
  parameters: Record<string, unknown>;
  /** Serialized function source code (runs in V8 isolate) */
  handler: string;
}

// ── Agent Configuration (from customer configure message) ──────────

/** Per-session agent configuration derived from the customer's configure message. */
export interface AgentConfig {
  /** System instructions for the LLM */
  instructions: string;
  /** Greeting text spoken at session start */
  greeting: string;
  /** TTS voice name */
  voice: string;
  /** Tool definitions with serialized handlers */
  tools: ToolDef[];
}

// ── Zod Schemas for incoming messages ──────────────────────────────

/** Zod schema for the initial "configure" message from the browser. */
export const ConfigureMessageSchema = z.object({
  type: z.literal("configure"),
  instructions: z.string().optional(),
  greeting: z.string().optional(),
  voice: z.string().optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.record(z.unknown()),
        handler: z.string(),
      })
    )
    .optional(),
});

/** Zod schema for control messages ("cancel" or "reset"). */
export const ControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("reset") }),
]);

// ── OpenAI-compatible types for LLM ────────────────────────────────

/** A message in the LLM chat history. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** A tool call requested by the LLM. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Tool schema sent to the LLM for function calling. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A single choice in an LLM response. */
export interface LLMChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

/** Complete LLM response (OpenAI chat completions format). */
export interface LLMResponse {
  id: string;
  choices: LLMChoice[];
}

// ── WebSocket Protocol Messages (server → browser) ─────────────────

/** Sent after STT connects; browser should start mic capture. */
export interface ReadyMessage {
  type: "ready";
  sampleRate: number;
  ttsSampleRate: number;
}

/** Initial greeting text (also triggers TTS). */
export interface GreetingMessage {
  type: "greeting";
  text: string;
}

/** Real-time transcript from STT. */
export interface TranscriptMessage {
  type: "transcript";
  text: string;
  final: boolean;
}

/** User's completed turn (sent after STT end-of-turn). */
export interface TurnMessage {
  type: "turn";
  text: string;
}

/** LLM is processing the user's turn. */
export interface ThinkingMessage {
  type: "thinking";
}

/** LLM response text with optional tool-use steps. */
export interface ChatResponseMessage {
  type: "chat";
  text: string;
  steps: string[];
}

/** TTS audio playback is complete. */
export interface TtsDoneMessage {
  type: "tts_done";
}

/** Cancellation acknowledged. */
export interface CancelledMessage {
  type: "cancelled";
}

/** Conversation reset acknowledged. */
export interface ResetMessage {
  type: "reset";
}

/** Error notification. */
export interface ErrorMessage {
  type: "error";
  message: string;
}

/** Union of all server → browser JSON messages. */
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
  | ErrorMessage;
