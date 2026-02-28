import { z } from "zod";

const DEFAULT_STT_SAMPLE_RATE = 16_000;
const DEFAULT_TTS_SAMPLE_RATE = 24_000;

export interface STTConfig {
  sampleRate: number;
  speechModel: string;
  wssBase: string;
  tokenExpiresIn: number;
  formatTurns: boolean;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
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

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const SttMessageSchema = z
  .object({
    type: z.string(),
    transcript: z.string().optional(),
    is_final: z.boolean().optional(),
    turn_is_formatted: z.boolean().optional(),
  })
  .passthrough();

export const ControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio_ready") }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("reset") }),
]);

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

const LLMChoiceSchema = z.object({
  index: z.number().optional(),
  message: ChatMessageSchema,
  finish_reason: z.string(),
});

export const LLMResponseSchema = z
  .object({
    id: z.string().optional(),
    choices: z.array(LLMChoiceSchema),
  })
  .passthrough();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentConfig {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}
