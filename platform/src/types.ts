// types.ts — All TypeScript interfaces and message types.

import { z } from "zod";

// ── STT Configuration ──────────────────────────────────────────────

export interface STTConfig {
  sampleRate: number;
  speechModel: string;
  wssBase: string;
  tokenExpiresIn: number;
  formatTurns: boolean;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
}

export const DEFAULT_STT_CONFIG: STTConfig = {
  sampleRate: 16000,
  speechModel: "u3-pro",
  wssBase: "wss://streaming.assemblyai.com/v3/ws",
  tokenExpiresIn: 480,
  formatTurns: true,
  minEndOfTurnSilenceWhenConfident: 400,
  maxTurnSilence: 1200,
};

// ── TTS Configuration ──────────────────────────────────────────────

export interface TTSConfig {
  wssUrl: string;
  apiKey: string;
  voice: string;
  maxTokens: number;
  bufferSize: number;
  repetitionPenalty: number;
  temperature: number;
  topP: number;
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
  sampleRate: 24000,
};

// ── LLM Configuration ──────────────────────────────────────────────

export const LLM_GATEWAY_BASE = "https://llm-gateway.assemblyai.com/v1";
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

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

export const VOICE_RULES =
  "\n\nCRITICAL: When you produce your final answer, it will be spoken aloud by a TTS system. " +
  "Write your answer exactly as you would say it out loud to a friend. " +
  "One to two sentences max. No markdown, no bullet points, no numbered lists, no code. " +
  "Sound like a human talking, not a document.";

export const DEFAULT_GREETING = "Hey there! I'm a voice assistant. What can I help you with?";

// ── Tool Definition (from customer configure message) ──────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: string; // serialized function source
}

// ── Agent Configuration (from customer configure message) ──────────

export interface AgentConfig {
  instructions: string;
  greeting: string;
  voice: string;
  tools: ToolDef[];
}

// ── Zod Schemas for incoming messages ──────────────────────────────

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

export const ControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("reset") }),
]);

// ── OpenAI-compatible types for LLM ────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface LLMResponse {
  id: string;
  choices: LLMChoice[];
}
