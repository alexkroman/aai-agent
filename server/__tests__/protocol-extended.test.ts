import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import { agentToolsToSchemas, zodToJsonSchema } from "../protocol.ts";
import type { ToolDef } from "../../sdk/agent.ts";

describe("zodToJsonSchema — edge cases", () => {
  it("handles boolean type", () => {
    const schema = z.object({ active: z.boolean() });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: { active: { type: "boolean" } },
      required: ["active"],
    });
  });

  it("handles optional boolean", () => {
    const schema = z.object({ verbose: z.boolean().optional() });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: { verbose: { type: "boolean" } },
    });
  });

  it("handles empty parameters object", () => {
    const schema = z.object({});
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {},
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
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string", description: "Email address" },
        active: { type: "boolean" },
      },
      required: ["name", "email"],
    });
  });

  it("preserves enum values", () => {
    const schema = z.object({
      color: z.enum(["red", "green", "blue"]),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        color: { type: "string", enum: ["red", "green", "blue"] },
      },
      required: ["color"],
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
        },
      },
      required: ["address"],
    });
  });

  it("handles array types", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["tags"],
    });
  });

  it("handles default values (unwraps to inner type)", () => {
    const schema = z.object({
      count: z.number().default(10),
    });
    // Default fields are not optional from Zod's perspective (they have a value)
    const result = zodToJsonSchema(schema);
    expect(result.properties).toEqual({
      count: { type: "number" },
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
    const tools = new Map<string, ToolDef>();
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
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
      },
    });
    expect(schemas[1]).toEqual({
      name: "tool_b",
      description: "Tool B",
      parameters: {
        type: "object",
        properties: {
          y: { type: "number" },
          z: { type: "boolean", description: "Flag" },
        },
        required: ["z"],
      },
    });
  });

  it("handles empty tool map", () => {
    expect(agentToolsToSchemas(new Map())).toEqual([]);
  });
});
