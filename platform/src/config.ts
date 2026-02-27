// config.ts — Centralized environment variable loading.

import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_WSS_URL,
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
}

/**
 * Load platform configuration from environment variables.
 * Falls back to defaults for optional values.
 */
export function loadPlatformConfig(): PlatformConfig {
  const ttsApiKey = process.env.ASSEMBLYAI_TTS_API_KEY ?? "";

  return {
    apiKey: process.env.ASSEMBLYAI_API_KEY ?? "",
    ttsApiKey,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      wssUrl: process.env.ASSEMBLYAI_TTS_WSS_URL ?? DEFAULT_TTS_WSS_URL,
      apiKey: ttsApiKey,
      voice: "jess",
      maxTokens: 2000,
      bufferSize: 105,
      repetitionPenalty: 1.2,
      temperature: 0.6,
      topP: 0.9,
      sampleRate: 24000,
    },
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
  };
}
