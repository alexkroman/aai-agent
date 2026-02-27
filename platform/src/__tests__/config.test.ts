import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadPlatformConfig } from "../config.js";

describe("loadPlatformConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set known env vars
    process.env.ASSEMBLYAI_API_KEY = "test-aai-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "test-tts-key";
    process.env.LLM_MODEL = "test-model";
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("loads API key from env", () => {
    const config = loadPlatformConfig();
    expect(config.apiKey).toBe("test-aai-key");
  });

  it("loads TTS API key from env", () => {
    const config = loadPlatformConfig();
    expect(config.ttsApiKey).toBe("test-tts-key");
  });

  it("sets TTS config apiKey from TTS env var", () => {
    const config = loadPlatformConfig();
    expect(config.ttsConfig.apiKey).toBe("test-tts-key");
  });

  it("loads model from env", () => {
    const config = loadPlatformConfig();
    expect(config.model).toBe("test-model");
  });

  it("uses defaults when env vars missing", () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_TTS_API_KEY;
    delete process.env.LLM_MODEL;

    const config = loadPlatformConfig();
    expect(config.apiKey).toBe("");
    expect(config.ttsApiKey).toBe("");
    expect(config.model).toBe("claude-haiku-4-5-20251001");
  });

  it("uses custom TTS WSS URL from env", () => {
    process.env.ASSEMBLYAI_TTS_WSS_URL = "wss://custom.example.com/ws";
    const config = loadPlatformConfig();
    expect(config.ttsConfig.wssUrl).toBe("wss://custom.example.com/ws");
  });

  it("uses default TTS WSS URL when env not set", () => {
    delete process.env.ASSEMBLYAI_TTS_WSS_URL;
    const config = loadPlatformConfig();
    expect(config.ttsConfig.wssUrl).toContain("baseten.co");
  });

  it("returns complete STT config", () => {
    const config = loadPlatformConfig();
    expect(config.sttConfig.sampleRate).toBe(16_000);
    expect(config.sttConfig.speechModel).toBe("u3-pro");
    expect(config.sttConfig.wssBase).toContain("assemblyai.com");
  });

  it("returns complete TTS config", () => {
    const config = loadPlatformConfig();
    expect(config.ttsConfig.voice).toBe("jess");
    expect(config.ttsConfig.sampleRate).toBe(24_000);
    expect(config.ttsConfig.maxTokens).toBe(2000);
  });
});
