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

  it("handles boolean type", () => {
    const schema = z.object({ active: z.boolean() });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: { active: { type: "boolean" } },
      required: ["active"],
      additionalProperties: false,
    });
  });

  it("handles empty parameters object", () => {
    const schema = z.object({});
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  it("handles nested objects", () => {
    const schema = z.object({
      address: z.object({
        street: z.string(),
        city: z.string(),
        zip: z.string().optional(),
      }),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zip: { type: "string" },
          },
          required: ["street", "city"],
          additionalProperties: false,
        },
      },
      required: ["address"],
      additionalProperties: false,
    });
  });

  it("handles array types", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["tags"],
      additionalProperties: false,
    });
  });

  it("handles default values", () => {
    const schema = z.object({
      count: z.number().default(10),
    });
    const result = zodToJsonSchema(schema);
    expect(result.properties).toEqual({
      count: { default: 10, type: "number" },
    });
  });

  it("handles descriptions on object schema", () => {
    const schema = z
      .object({ x: z.number() })
      .describe("A point coordinate");
    const result = zodToJsonSchema(schema);
    expect(result.description).toBe("A point coordinate");
    expect(result.type).toBe("object");
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

  it("converts multiple tool definitions", () => {
    const tools = new Map<string, StoredToolDef>();
    tools.set("tool_a", {
      description: "Tool A",
      parameters: z.object({ x: z.string() }),
      handler: async () => {},
    });
    tools.set("tool_b", {
      description: "Tool B",
      parameters: z.object({
        y: z.number().optional(),
        z: z.boolean().describe("Flag"),
      }),
      handler: async () => {},
    });

    const schemas = agentToolsToSchemas(tools);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].name).toBe("tool_a");
    expect(schemas[1].name).toBe("tool_b");
  });

  it("handles empty tool map", () => {
    expect(agentToolsToSchemas(new Map())).toEqual([]);
  });
});
