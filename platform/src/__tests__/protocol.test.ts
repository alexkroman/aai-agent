import { describe, it, expect } from "vitest";
import { toJsonSchema, toolDefsToSchemas } from "../protocol.js";

describe("toJsonSchema", () => {
  it("converts simple string types", () => {
    const result = toJsonSchema({ city: "string" });
    expect(result).toEqual({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    });
  });

  it("handles optional parameters with ?", () => {
    const result = toJsonSchema({ limit: "number?" });
    expect(result).toEqual({
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    });
  });

  it("converts extended format with description", () => {
    const result = toJsonSchema({
      city: { type: "string", description: "City name" },
    });
    expect(result).toEqual({
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    });
  });

  it("handles extended format with enum", () => {
    const result = toJsonSchema({
      status: { type: "string", enum: ["open", "closed"] },
    });
    expect(result).toEqual({
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "closed"] },
      },
      required: ["status"],
    });
  });

  it("handles optional extended format", () => {
    const result = toJsonSchema({
      time: { type: "string?", description: "Preferred time" },
    });
    expect(result).toEqual({
      type: "object",
      properties: {
        time: { type: "string", description: "Preferred time" },
      },
      required: [],
    });
  });

  it("passes through raw JSON Schema", () => {
    const raw = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };
    expect(toJsonSchema(raw)).toEqual(raw);
  });

  it("handles mixed required and optional", () => {
    const result = toJsonSchema({
      phone: { type: "string", description: "Phone number" },
      time: { type: "string?", description: "Preferred time" },
    });
    expect(result).toEqual({
      type: "object",
      properties: {
        phone: { type: "string", description: "Phone number" },
        time: { type: "string", description: "Preferred time" },
      },
      required: ["phone"],
    });
  });
});

describe("toolDefsToSchemas", () => {
  it("converts tool definitions to OpenAI schemas", () => {
    const schemas = toolDefsToSchemas([
      {
        name: "get_weather",
        description: "Get weather",
        parameters: { city: { type: "string", description: "City" } },
        handler: "async (args, ctx) => {}",
      },
    ]);
    expect(schemas).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        parameters: {
          type: "object",
          properties: { city: { type: "string", description: "City" } },
          required: ["city"],
        },
      },
    ]);
  });
});
