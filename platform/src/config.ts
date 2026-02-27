// config.ts — Centralized environment variable loading.

import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  type STTConfig,
  type TTSConfig,
} from "./types.js";

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
export function loadPlatformConfig(env: Record<string, string | undefined>): PlatformConfig {
  const apiKey = env.ASSEMBLYAI_API_KEY;
  const ttsApiKey = env.ASSEMBLYAI_TTS_API_KEY;

  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY environment variable is required");
  }
  if (!ttsApiKey) {
    throw new Error("ASSEMBLYAI_TTS_API_KEY environment variable is required");
  }

  return {
    apiKey,
    ttsApiKey,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      ...DEFAULT_TTS_CONFIG,
      wssUrl: env.ASSEMBLYAI_TTS_WSS_URL ?? DEFAULT_TTS_CONFIG.wssUrl,
      apiKey: ttsApiKey,
    },
    model: env.LLM_MODEL ?? DEFAULT_MODEL,
    llmGatewayBase: env.LLM_GATEWAY_BASE ?? "https://llm-gateway.assemblyai.com/v1",
  };
}
