import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import { agentToolsToSchemas, zodToJsonSchema } from "../protocol.ts";
import type { StoredToolDef } from "../../sdk/agent.ts";

const $schema = "https://json-schema.org/draft/2020-12/schema";

describe("zodToJsonSchema", () => {
  it("converts a simple string field", () => {
    const schema = z.object({ city: z.string() });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    });
  });

  it("handles optional parameters", () => {
    const schema = z.object({ limit: z.number().optional() });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    });
  });

  it("includes description from .describe()", () => {
    const schema = z.object({
      city: z.string().describe("City name"),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
      additionalProperties: false,
    });
  });

  it("handles enum types", () => {
    const schema = z.object({
      status: z.enum(["open", "closed"]),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "closed"] },
      },
      required: ["status"],
      additionalProperties: false,
    });
  });

  it("handles optional fields with description", () => {
    const schema = z.object({
      time: z.string().optional().describe("Preferred time"),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        time: { description: "Preferred time", type: "string" },
      },
      additionalProperties: false,
    });
  });

  it("handles mixed required and optional", () => {
    const schema = z.object({
      phone: z.string().describe("Phone number"),
      time: z.string().optional().describe("Preferred time"),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        phone: { type: "string", description: "Phone number" },
        time: { description: "Preferred time", type: "string" },
      },
      required: ["phone"],
      additionalProperties: false,
    });
  });
});

describe("agentToolsToSchemas", () => {
  it("converts tool definitions to OpenAI schemas", () => {
    const tools = new Map<string, StoredToolDef>();
    tools.set("get_weather", {
      description: "Get weather",
      parameters: z.object({ city: z.string().describe("City") }),
      handler: async () => {},
    });
    const schemas = agentToolsToSchemas(tools);
    expect(schemas).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        parameters: {
          $schema,
          type: "object",
          properties: { city: { type: "string", description: "City" } },
          required: ["city"],
          additionalProperties: false,
        },
      },
    ]);
  });
});
