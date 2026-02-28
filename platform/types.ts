// types.ts — Platform-specific type definitions for STT, TTS, and LLM services.

import { z } from "zod";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  MSG,
} from "../sdk/shared-protocol.ts";

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
  sampleRate: DEFAULT_STT_SAMPLE_RATE,
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
  sampleRate: DEFAULT_TTS_SAMPLE_RATE,
};

// ── LLM Configuration ──────────────────────────────────────────────

/** Default LLM model identifier. */
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// ── STT Message Schema ─────────────────────────────────────────────

/** Zod schema for STT messages received from AssemblyAI streaming. */
export const SttMessageSchema = z
  .object({
    type: z.string(),
    transcript: z.string().optional(),
    is_final: z.boolean().optional(),
    turn_is_formatted: z.boolean().optional(),
  })
  .passthrough();

// ── Control Message Schema (browser -> server after connection) ──

/** Schema for browser control messages (audio_ready, cancel, reset). */
export const ControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(MSG.AUDIO_READY) }),
  z.object({ type: z.literal(MSG.CANCEL) }),
  z.object({ type: z.literal(MSG.RESET) }),
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

/** Agent config as returned by WorkerApi.getConfig(). */
export interface WorkerReadyConfig {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}
