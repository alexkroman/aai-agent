// types.ts — All TypeScript interfaces, message types, and Zod schemas.

import { z } from "zod";

// ── STT Configuration ──────────────────────────────────────────────

/** Configuration for the AssemblyAI streaming speech-to-text service. */
export interface STTConfig {
  /** Audio sample rate in Hz (e.g., 16000). */
  sampleRate: number;
  /** AssemblyAI speech model identifier (e.g., "u3-pro"). */
  speechModel: string;
  /** Base WebSocket URL for AssemblyAI streaming. */
  wssBase: string;
  /** Token expiration time in seconds. */
  tokenExpiresIn: number;
  /** Whether to format completed turns. */
  formatTurns: boolean;
  /** Minimum silence (ms) to end a turn when confidence is high. */
  minEndOfTurnSilenceWhenConfident: number;
  /** Maximum silence (ms) before ending a turn. */
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

/** Configuration for the Orpheus TTS service (via Baseten WebSocket). */
export interface TTSConfig {
  /** WebSocket URL for the TTS service. */
  wssUrl: string;
  /** API key for TTS authentication. */
  apiKey: string;
  /** Voice name (e.g., "jess", "luna"). */
  voice: string;
  /** Maximum tokens to generate. */
  maxTokens: number;
  /** Audio buffer size. */
  bufferSize: number;
  /** Repetition penalty for generation. */
  repetitionPenalty: number;
  /** Sampling temperature. */
  temperature: number;
  /** Top-p (nucleus) sampling threshold. */
  topP: number;
  /** Output audio sample rate in Hz (e.g., 24000). */
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

/** A tool definition received from the browser in the configure message. */
export interface ToolDef {
  /** Unique tool name (e.g., "get_weather"). */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** Parameter schema (simplified or JSON Schema). */
  parameters: Record<string, unknown>;
  /** Serialized handler function source code. */
  handler: string;
}

// ── Agent Configuration (from customer configure message) ──────────

/** Agent configuration extracted from the browser's configure message. */
export interface AgentConfig {
  /** System prompt / instructions for the LLM. */
  instructions: string;
  /** Initial greeting message spoken to the user. */
  greeting: string;
  /** TTS voice name. */
  voice: string;
  /** Tool definitions with serialized handlers. */
  tools: ToolDef[];
}

// ── Zod Schemas for incoming messages ──────────────────────────────

/** Schema for the browser's authenticate message (must be first). */
export const AuthenticateMessageSchema = z.object({
  type: z.literal("authenticate"),
  apiKey: z.string().min(1),
});

/** Schema for the browser's configure message. */
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
        parameters: z.record(z.string(), z.unknown()),
        handler: z.string(),
      })
    )
    .optional(),
});

/** Schema for browser control messages (cancel, reset). */
export const ControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("reset") }),
]);

// ── OpenAI-compatible types for LLM ────────────────────────────────

/** A message in the LLM conversation (OpenAI chat format). */
export interface ChatMessage {
  /** Message role: system, user, assistant, or tool. */
  role: "system" | "user" | "assistant" | "tool";
  /** Text content (null when message only has tool_calls). */
  content: string | null;
  /** Tool calls requested by the assistant. */
  tool_calls?: ToolCall[];
  /** ID of the tool call this message responds to. */
  tool_call_id?: string;
}

/** A tool call requested by the LLM. */
export interface ToolCall {
  /** Unique identifier for this tool call. */
  id: string;
  /** Always "function" for function-calling tools. */
  type: "function";
  /** Function name and JSON-encoded arguments. */
  function: { name: string; arguments: string };
}

/** OpenAI-compatible tool schema for the LLM request. */
export interface ToolSchema {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

/** A single choice from an LLM response. */
export interface LLMChoice {
  /** Choice index (usually 0). */
  index: number;
  /** The assistant's message. */
  message: ChatMessage;
  /** Why the model stopped: "stop", "tool_calls", "length". */
  finish_reason: string;
}

/** Complete LLM response (OpenAI chat completion format). */
export interface LLMResponse {
  /** Unique completion ID. */
  id: string;
  /** Array of response choices. */
  choices: LLMChoice[];
}

// ── WebSocket Protocol Types (server → browser) ────────────────────

/** Server tells browser STT is ready; includes sample rates. */
export interface ReadyMessage {
  type: "ready";
  sampleRate: number;
  ttsSampleRate: number;
}

/** Server sends the initial greeting text. */
export interface GreetingMessage {
  type: "greeting";
  text: string;
}

/** Real-time speech transcript (partial or final). */
export interface TranscriptMessage {
  type: "transcript";
  text: string;
  final: boolean;
}

/** A completed user turn (speech finalized). */
export interface TurnMessage {
  type: "turn";
  text: string;
}

/** Server is processing (LLM thinking). */
export interface ThinkingMessage {
  type: "thinking";
}

/** LLM response with optional tool-use steps. */
export interface ChatResponseMessage {
  type: "chat";
  text: string;
  steps: string[];
}

/** TTS audio playback is complete. */
export interface TtsDoneMessage {
  type: "tts_done";
}

/** Cancel acknowledged. */
export interface CancelledMessage {
  type: "cancelled";
}

/** Conversation reset acknowledged. */
export interface ResetMessage {
  type: "reset";
}

/** Error message from the server. */
export interface ErrorMessage {
  type: "error";
  message: string;
}

/** Discriminated union of all server → browser messages. */
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
