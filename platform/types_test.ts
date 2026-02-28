import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  ControlMessageSchema,
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  LLMResponseSchema,
  SttMessageSchema,
} from "./types.ts";

describe("SttMessageSchema", () => {
  it("validates a Transcript message", () => {
    const result = SttMessageSchema.safeParse({
      type: "Transcript",
      transcript: "hello",
      is_final: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates a Turn message", () => {
    const result = SttMessageSchema.safeParse({
      type: "Turn",
      transcript: "hello world",
      turn_is_formatted: true,
    });
    expect(result.success).toBe(true);
  });

  it("allows passthrough of extra fields", () => {
    const result = SttMessageSchema.safeParse({
      type: "Transcript",
      transcript: "hi",
      extra_field: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when type is missing", () => {
    const result = SttMessageSchema.safeParse({ transcript: "hi" });
    expect(result.success).toBe(false);
  });

  it("rejects when type is not a string", () => {
    const result = SttMessageSchema.safeParse({ type: 123 });
    expect(result.success).toBe(false);
  });
});

describe("ControlMessageSchema", () => {
  it("validates audio_ready", () => {
    const result = ControlMessageSchema.safeParse({ type: "audio_ready" });
    expect(result.success).toBe(true);
  });

  it("validates cancel", () => {
    const result = ControlMessageSchema.safeParse({ type: "cancel" });
    expect(result.success).toBe(true);
  });

  it("validates reset", () => {
    const result = ControlMessageSchema.safeParse({ type: "reset" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown type", () => {
    const result = ControlMessageSchema.safeParse({ type: "unknown" });
    expect(result.success).toBe(false);
  });

  it("rejects missing type", () => {
    const result = ControlMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("LLMResponseSchema", () => {
  it("validates a complete response", () => {
    const result = LLMResponseSchema.safeParse({
      id: "chatcmpl-123",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a response with tool_calls", () => {
    const result = LLMResponseSchema.safeParse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"NYC"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when choices is missing", () => {
    const result = LLMResponseSchema.safeParse({ id: "test" });
    expect(result.success).toBe(false);
  });

  it("rejects when message is missing from choice", () => {
    const result = LLMResponseSchema.safeParse({
      choices: [{ finish_reason: "stop" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("platform default constants", () => {
  it("DEFAULT_MODEL is a non-empty string", () => {
    expect(typeof DEFAULT_MODEL).toBe("string");
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });

  it("DEFAULT_STT_CONFIG has expected shape", () => {
    expect(DEFAULT_STT_CONFIG.sampleRate).toBe(16_000);
    expect(DEFAULT_STT_CONFIG.speechModel).toBe("u3-pro");
    expect(typeof DEFAULT_STT_CONFIG.wssBase).toBe("string");
    expect(DEFAULT_STT_CONFIG.formatTurns).toBe(true);
  });

  it("DEFAULT_TTS_CONFIG has expected shape", () => {
    expect(DEFAULT_TTS_CONFIG.sampleRate).toBe(24_000);
    expect(typeof DEFAULT_TTS_CONFIG.voice).toBe("string");
    expect(typeof DEFAULT_TTS_CONFIG.wssUrl).toBe("string");
  });
});
