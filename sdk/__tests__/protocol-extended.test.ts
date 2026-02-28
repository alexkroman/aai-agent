import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import { agentToolsToSchemas, zodToJsonSchema } from "../protocol.ts";
import type { StoredToolDef } from "../../sdk/agent.ts";

const $schema = "https://json-schema.org/draft/2020-12/schema";

describe("zodToJsonSchema — edge cases", () => {
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

  it("handles optional boolean", () => {
    const schema = z.object({ verbose: z.boolean().optional() });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: { verbose: { type: "boolean" } },
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

  it("handles multiple parameters with mixed required/optional", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      email: z.string().describe("Email address"),
      active: z.boolean().optional(),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string", description: "Email address" },
        active: { type: "boolean" },
      },
      required: ["name", "email"],
      additionalProperties: false,
    });
  });

  it("preserves enum values", () => {
    const schema = z.object({
      color: z.enum(["red", "green", "blue"]),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      $schema,
      type: "object",
      properties: {
        color: { type: "string", enum: ["red", "green", "blue"] },
      },
      required: ["color"],
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

describe("agentToolsToSchemas — multiple tools", () => {
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
    expect(schemas[0]).toEqual({
      name: "tool_a",
      description: "Tool A",
      parameters: {
        $schema,
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
        additionalProperties: false,
      },
    });
    expect(schemas[1]).toEqual({
      name: "tool_b",
      description: "Tool B",
      parameters: {
        $schema,
        type: "object",
        properties: {
          y: { type: "number" },
          z: { type: "boolean", description: "Flag" },
        },
        required: ["z"],
        additionalProperties: false,
      },
    });
  });

  it("handles empty tool map", () => {
    expect(agentToolsToSchemas(new Map())).toEqual([]);
  });
});
