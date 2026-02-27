// config.ts — Centralized configuration loading from environment variables.

import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  type STTConfig,
  type TTSConfig,
} from "./types.js";

/** All platform configuration derived from environment variables. */
export interface PlatformConfig {
  /** AssemblyAI API key for STT and LLM gateway */
  apiKey: string;
  /** Baseten API key for Orpheus TTS */
  ttsApiKey: string;
  /** Speech-to-text configuration */
  sttConfig: STTConfig;
  /** Text-to-speech configuration */
  ttsConfig: TTSConfig;
  /** LLM model identifier */
  model: string;
}

/**
 * Load platform configuration from environment variables.
 * Call once at startup; pass the result to components that need it.
 */
export function loadPlatformConfig(): PlatformConfig {
  const ttsApiKey = process.env.ASSEMBLYAI_TTS_API_KEY ?? "";
  return {
    apiKey: process.env.ASSEMBLYAI_API_KEY ?? "",
    ttsApiKey,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      ...DEFAULT_TTS_CONFIG,
      wssUrl: process.env.ASSEMBLYAI_TTS_WSS_URL ?? DEFAULT_TTS_CONFIG.wssUrl,
      apiKey: ttsApiKey,
    },
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
  };
}
