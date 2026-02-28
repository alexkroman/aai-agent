import { assertEquals } from "@std/assert";
import { z } from "zod";
import { agentToolsToSchemas } from "./protocol.ts";
import type { ToolDef } from "./agent_types.ts";

/** Inline helper — mirrors what protocol.ts used to export. */
const zodToJsonSchema = (schema: z.ZodObject<z.ZodRawShape>) =>
  z.toJSONSchema(schema) as Record<string, unknown>;

const $schema = "https://json-schema.org/draft/2020-12/schema";

Deno.test("zodToJsonSchema - converts a simple string field", () => {
  const schema = z.object({ city: z.string() });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles optional parameters", () => {
  const schema = z.object({ limit: z.number().optional() });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: { limit: { type: "number" } },
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - includes description from .describe()", () => {
  const schema = z.object({
    city: z.string().describe("City name"),
  });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: { city: { type: "string", description: "City name" } },
    required: ["city"],
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles enum types", () => {
  const schema = z.object({
    status: z.enum(["open", "closed"]),
  });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "closed"] },
    },
    required: ["status"],
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles optional fields with description", () => {
  const schema = z.object({
    time: z.string().optional().describe("Preferred time"),
  });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: {
      time: { description: "Preferred time", type: "string" },
    },
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles mixed required and optional", () => {
  const schema = z.object({
    phone: z.string().describe("Phone number"),
    time: z.string().optional().describe("Preferred time"),
  });
  assertEquals(zodToJsonSchema(schema), {
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

Deno.test("zodToJsonSchema - handles boolean type", () => {
  const schema = z.object({ active: z.boolean() });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: { active: { type: "boolean" } },
    required: ["active"],
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles empty parameters object", () => {
  const schema = z.object({});
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: {},
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles nested objects", () => {
  const schema = z.object({
    address: z.object({
      street: z.string(),
      city: z.string(),
      zip: z.string().optional(),
    }),
  });
  assertEquals(zodToJsonSchema(schema), {
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

Deno.test("zodToJsonSchema - handles array types", () => {
  const schema = z.object({
    tags: z.array(z.string()),
  });
  assertEquals(zodToJsonSchema(schema), {
    $schema,
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["tags"],
    additionalProperties: false,
  });
});

Deno.test("zodToJsonSchema - handles default values", () => {
  const schema = z.object({
    count: z.number().default(10),
  });
  const result = zodToJsonSchema(schema);
  assertEquals(
    result.properties as Record<string, unknown>,
    { count: { default: 10, type: "number" } },
  );
});

Deno.test("zodToJsonSchema - handles descriptions on object schema", () => {
  const schema = z
    .object({ x: z.number() })
    .describe("A point coordinate");
  const result = zodToJsonSchema(schema);
  assertEquals(result.description, "A point coordinate");
  assertEquals(result.type, "object");
});

Deno.test("agentToolsToSchemas - converts tool definitions", () => {
  const tools: Record<string, ToolDef> = {
    get_weather: {
      description: "Get weather",
      parameters: z.object({ city: z.string().describe("City") }),
      handler: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  assertEquals(schemas, [
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

Deno.test("agentToolsToSchemas - converts multiple tools", () => {
  const tools: Record<string, ToolDef> = {
    tool_a: {
      description: "Tool A",
      parameters: z.object({ x: z.string() }),
      handler: async () => {},
    },
    tool_b: {
      description: "Tool B",
      parameters: z.object({
        y: z.number().optional(),
        z: z.boolean().describe("Flag"),
      }),
      handler: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  assertEquals(schemas.length, 2);
  assertEquals(schemas[0].name, "tool_a");
  assertEquals(schemas[1].name, "tool_b");
});

Deno.test("agentToolsToSchemas - handles empty tools", () => {
  assertEquals(agentToolsToSchemas({}), []);
});
