import { describe, it, expect } from "vitest";
import { ConfigureMessageSchema, ControlMessageSchema } from "../types.js";

describe("ConfigureMessageSchema", () => {
  it("validates minimal configure message", () => {
    const result = ConfigureMessageSchema.safeParse({
      type: "configure",
    });
    expect(result.success).toBe(true);
  });

  it("validates full configure message", () => {
    const result = ConfigureMessageSchema.safeParse({
      type: "configure",
      instructions: "Be helpful.",
      greeting: "Hi!",
      voice: "jess",
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          parameters: { city: { type: "string" } },
          handler: "async (args, ctx) => {}",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toHaveLength(1);
      expect(result.data.tools![0].name).toBe("get_weather");
    }
  });

  it("rejects non-configure type", () => {
    const result = ConfigureMessageSchema.safeParse({
      type: "cancel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing type", () => {
    const result = ConfigureMessageSchema.safeParse({
      instructions: "test",
    });
    expect(result.success).toBe(false);
  });

  it("validates tools array structure", () => {
    const result = ConfigureMessageSchema.safeParse({
      type: "configure",
      tools: [
        {
          name: "tool1",
          description: "desc",
          parameters: {},
          handler: "async () => {}",
        },
        {
          name: "tool2",
          description: "desc2",
          parameters: { x: "string" },
          handler: "async (args) => args.x",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toHaveLength(2);
    }
  });

  it("rejects tool missing required fields", () => {
    const result = ConfigureMessageSchema.safeParse({
      type: "configure",
      tools: [
        {
          name: "tool1",
          // missing description, parameters, handler
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty tools array", () => {
    const result = ConfigureMessageSchema.safeParse({
      type: "configure",
      tools: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("ControlMessageSchema", () => {
  it("validates cancel message", () => {
    const result = ControlMessageSchema.safeParse({ type: "cancel" });
    expect(result.success).toBe(true);
  });

  it("validates reset message", () => {
    const result = ControlMessageSchema.safeParse({ type: "reset" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown control type", () => {
    const result = ControlMessageSchema.safeParse({ type: "pause" });
    expect(result.success).toBe(false);
  });

  it("rejects configure as control message", () => {
    const result = ControlMessageSchema.safeParse({ type: "configure" });
    expect(result.success).toBe(false);
  });
});
