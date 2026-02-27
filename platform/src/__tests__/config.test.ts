import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadPlatformConfig } from "../config.js";

describe("loadPlatformConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_TTS_API_KEY;
    delete process.env.ASSEMBLYAI_TTS_WSS_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when ASSEMBLYAI_API_KEY is missing", () => {
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    expect(() => loadPlatformConfig()).toThrow(
      "ASSEMBLYAI_API_KEY environment variable is required"
    );
  });

  it("throws when ASSEMBLYAI_TTS_API_KEY is missing", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    expect(() => loadPlatformConfig()).toThrow(
      "ASSEMBLYAI_TTS_API_KEY environment variable is required"
    );
  });

  it("reads ASSEMBLYAI_API_KEY from env", () => {
    process.env.ASSEMBLYAI_API_KEY = "test-api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    const config = loadPlatformConfig();
    expect(config.apiKey).toBe("test-api-key");
  });

  it("reads ASSEMBLYAI_TTS_API_KEY from env", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "test-tts-key";
    const config = loadPlatformConfig();
    expect(config.ttsApiKey).toBe("test-tts-key");
    expect(config.ttsConfig.apiKey).toBe("test-tts-key");
  });

  it("reads ASSEMBLYAI_TTS_WSS_URL from env", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    process.env.ASSEMBLYAI_TTS_WSS_URL = "wss://custom-tts.example.com";
    const config = loadPlatformConfig();
    expect(config.ttsConfig.wssUrl).toBe("wss://custom-tts.example.com");
  });

  it("reads LLM_MODEL from env", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    process.env.LLM_MODEL = "gpt-4o";
    const config = loadPlatformConfig();
    expect(config.model).toBe("gpt-4o");
  });

  it("uses default TTS WSS URL when not set", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    const config = loadPlatformConfig();
    expect(config.ttsConfig.wssUrl).toContain("baseten.co");
  });

  it("includes correct TTS config defaults", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    const config = loadPlatformConfig();
    expect(config.ttsConfig.voice).toBe("jess");
    expect(config.ttsConfig.maxTokens).toBe(2000);
    expect(config.ttsConfig.temperature).toBe(0.6);
    expect(config.ttsConfig.topP).toBe(0.9);
  });

  it("returns a fresh sttConfig copy each call", () => {
    process.env.ASSEMBLYAI_API_KEY = "api-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "tts-key";
    const config1 = loadPlatformConfig();
    const config2 = loadPlatformConfig();
    expect(config1.sttConfig).not.toBe(config2.sttConfig);
    expect(config1.sttConfig).toEqual(config2.sttConfig);
  });
});
