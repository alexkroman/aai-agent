import { describe, it, expect } from "vitest";
import { loadPlatformConfig } from "../config.js";

describe("loadPlatformConfig", () => {
  const baseEnv = {
    ASSEMBLYAI_API_KEY: "api-key",
    ASSEMBLYAI_TTS_API_KEY: "tts-key",
  };

  it("throws when ASSEMBLYAI_API_KEY is missing", () => {
    expect(() => loadPlatformConfig({ ASSEMBLYAI_TTS_API_KEY: "tts-key" })).toThrow(
      "ASSEMBLYAI_API_KEY environment variable is required"
    );
  });

  it("throws when ASSEMBLYAI_TTS_API_KEY is missing", () => {
    expect(() => loadPlatformConfig({ ASSEMBLYAI_API_KEY: "api-key" })).toThrow(
      "ASSEMBLYAI_TTS_API_KEY environment variable is required"
    );
  });

  it("reads ASSEMBLYAI_API_KEY from env", () => {
    const config = loadPlatformConfig({ ...baseEnv, ASSEMBLYAI_API_KEY: "test-api-key" });
    expect(config.apiKey).toBe("test-api-key");
  });

  it("reads ASSEMBLYAI_TTS_API_KEY from env", () => {
    const config = loadPlatformConfig({ ...baseEnv, ASSEMBLYAI_TTS_API_KEY: "test-tts-key" });
    expect(config.ttsApiKey).toBe("test-tts-key");
    expect(config.ttsConfig.apiKey).toBe("test-tts-key");
  });

  it("reads ASSEMBLYAI_TTS_WSS_URL from env", () => {
    const config = loadPlatformConfig({
      ...baseEnv,
      ASSEMBLYAI_TTS_WSS_URL: "wss://custom-tts.example.com",
    });
    expect(config.ttsConfig.wssUrl).toBe("wss://custom-tts.example.com");
  });

  it("reads LLM_MODEL from env", () => {
    const config = loadPlatformConfig({ ...baseEnv, LLM_MODEL: "gpt-4o" });
    expect(config.model).toBe("gpt-4o");
  });

  it("uses default TTS WSS URL when not set", () => {
    const config = loadPlatformConfig(baseEnv);
    expect(config.ttsConfig.wssUrl).toContain("baseten.co");
  });

  it("includes correct TTS config defaults", () => {
    const config = loadPlatformConfig(baseEnv);
    expect(config.ttsConfig.voice).toBe("jess");
    expect(config.ttsConfig.maxTokens).toBe(2000);
    expect(config.ttsConfig.temperature).toBe(0.6);
    expect(config.ttsConfig.topP).toBe(0.9);
  });

  it("returns a fresh sttConfig copy each call", () => {
    const config1 = loadPlatformConfig(baseEnv);
    const config2 = loadPlatformConfig(baseEnv);
    expect(config1.sttConfig).not.toBe(config2.sttConfig);
    expect(config1.sttConfig).toEqual(config2.sttConfig);
  });
});
