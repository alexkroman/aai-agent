import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { loadPlatformConfig } from "./config.ts";
import { DEFAULT_MODEL } from "./types.ts";

describe("loadPlatformConfig", () => {
  const validEnv = {
    ASSEMBLYAI_API_KEY: "test-key-123",
    ASSEMBLYAI_TTS_API_KEY: "test-tts-key-456",
  };

  it("loads config from valid env", () => {
    const config = loadPlatformConfig(validEnv);
    expect(config.apiKey).toBe("test-key-123");
    expect(config.ttsApiKey).toBe("test-tts-key-456");
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.sttConfig.sampleRate).toBe(16_000);
    expect(config.ttsConfig.apiKey).toBe("test-tts-key-456");
    expect(config.llmGatewayBase).toBe(
      "https://llm-gateway.assemblyai.com/v1",
    );
  });

  it("throws when ASSEMBLYAI_API_KEY is missing", () => {
    expect(() => loadPlatformConfig({ ASSEMBLYAI_TTS_API_KEY: "key" }))
      .toThrow();
  });

  it("throws when ASSEMBLYAI_TTS_API_KEY is missing", () => {
    expect(() => loadPlatformConfig({ ASSEMBLYAI_API_KEY: "key" })).toThrow();
  });

  it("throws when ASSEMBLYAI_API_KEY is empty string", () => {
    expect(() =>
      loadPlatformConfig({
        ASSEMBLYAI_API_KEY: "",
        ASSEMBLYAI_TTS_API_KEY: "key",
      })
    ).toThrow();
  });

  it("uses LLM_MODEL override when provided", () => {
    const config = loadPlatformConfig({
      ...validEnv,
      LLM_MODEL: "custom-model",
    });
    expect(config.model).toBe("custom-model");
  });

  it("uses default model when LLM_MODEL not provided", () => {
    const config = loadPlatformConfig(validEnv);
    expect(config.model).toBe(DEFAULT_MODEL);
  });
});
