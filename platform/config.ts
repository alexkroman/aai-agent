// config.ts — Centralized environment variable loading (Deno-native).

import { z } from "zod";
import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  type STTConfig,
  type TTSConfig,
} from "../sdk/types.ts";

const EnvSchema = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1, "ASSEMBLYAI_API_KEY is required"),
  ASSEMBLYAI_TTS_API_KEY: z.string().min(
    1,
    "ASSEMBLYAI_TTS_API_KEY is required",
  ),
  LLM_MODEL: z.string().optional(),
});

/** Platform configuration loaded from environment variables. */
export interface PlatformConfig {
  apiKey: string;
  ttsApiKey: string;
  sttConfig: STTConfig;
  ttsConfig: TTSConfig;
  model: string;
  llmGatewayBase: string;
}

/**
 * Load platform configuration from an explicit env object.
 * Falls back to defaults for optional values.
 */
export function loadPlatformConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const parsed = EnvSchema.parse(env);

  return {
    apiKey: parsed.ASSEMBLYAI_API_KEY,
    ttsApiKey: parsed.ASSEMBLYAI_TTS_API_KEY,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      ...DEFAULT_TTS_CONFIG,
      apiKey: parsed.ASSEMBLYAI_TTS_API_KEY,
    },
    model: parsed.LLM_MODEL ?? DEFAULT_MODEL,
    llmGatewayBase: "https://llm-gateway.assemblyai.com/v1",
  };
}
