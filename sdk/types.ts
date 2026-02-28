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
  /** Optional transcription prompt to guide STT (supported by u3-pro). */
  prompt?: string;
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
  wssUrl:
    "wss://model-q844y7pw.api.baseten.co/environments/production/websocket",
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
  "\n\nCRITICAL OUTPUT RULES — you MUST follow these for EVERY response:\n" +
  "Your response will be spoken aloud by a TTS system and displayed as plain text.\n" +
  "- NEVER use markdown: no **, no *, no _, no #, no `, no [](), no ---\n" +
  "- NEVER use bullet points (-, *, •) or numbered lists (1., 2.)\n" +
  "- NEVER use code blocks or inline code\n" +
  "- Write exactly as you would say it out loud to a friend\n" +
  '- Use short conversational sentences. To list things, say "First," "Next," "Finally,"\n' +
  "- Keep responses concise — a few sentences max";

/** Default greeting spoken when a session starts. */
export const DEFAULT_GREETING =
  "Hey there! I'm a voice assistant. What can I help you with?";

// ── STT Message Schema (for validating incoming STT WebSocket messages) ──

/** Zod schema for STT messages received from AssemblyAI streaming. */
export const SttMessageSchema = z
  .object({
    type: z.string(),
    transcript: z.string().optional(),
    is_final: z.boolean().optional(),
    turn_is_formatted: z.boolean().optional(),
  })
  .passthrough();

// ── Agent Configuration (internal, built from Agent class) ──────────

/** Agent configuration used internally by VoiceSession. */
export interface AgentConfig {
  /** System prompt / instructions for the LLM. */
  instructions: string;
  /** Initial greeting message spoken to the user. */
  greeting: string;
  /** TTS voice name. */
  voice: string;
  /** Optional transcription prompt to guide STT. */
  prompt?: string;
  /** Names of built-in server-side tools to enable (e.g., ["web_search"]). */
  builtinTools?: string[];
}

// ── Control Message Schema (browser -> server after connection) ──

/** Schema for browser control messages (audio_ready, cancel, reset). */
export const ControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio_ready") }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("reset") }),
]);

// ── OpenAI-compatible types for LLM ────────────────────────────────

/** Zod schema for a tool call requested by the LLM. */
const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

/** Zod schema for a message in the LLM conversation (OpenAI chat format). */
const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

/** Zod schema for a single choice from an LLM response. */
const LLMChoiceSchema = z.object({
  index: z.number().optional(),
  message: ChatMessageSchema,
  finish_reason: z.string(),
});

/** Zod schema for a complete LLM response (OpenAI chat completion format). */
export const LLMResponseSchema = z
  .object({
    id: z.string().optional(),
    choices: z.array(LLMChoiceSchema),
  })
  .passthrough();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

/** OpenAI-compatible tool schema for the LLM request. */
export interface ToolSchema {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

// ── Worker Config Type ──────────────────────────────────────────

/** Agent config as returned by WorkerApi.getConfig() (matches AgentOptions). */
export interface WorkerReadyConfig {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}
