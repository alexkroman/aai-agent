// protocol.ts — Message parsing, validation, simplified→JSON Schema conversion.

import type { ToolDef, ToolSchema } from "./types.js";

/**
 * Convert simplified parameter format to JSON Schema.
 *
 * Supports three forms:
 * 1. Simple:   { city: "string" }
 * 2. Extended: { city: { type: "string", description: "City name" } }
 * 3. Raw:      { type: "object", properties: { ... } } — pass-through
 */
export function toJsonSchema(params: Record<string, unknown>): Record<string, unknown> {
  // Raw JSON Schema — pass through if root has "type" key
  if ("type" in params && typeof params.type === "string") {
    return params;
  }

  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      // Simple form: "string", "number?", "boolean"
      const optional = value.endsWith("?");
      const typeName = optional ? value.slice(0, -1) : value;
      properties[key] = { type: typeName };
      if (!optional) required.push(key);
    } else if (typeof value === "object" && value !== null && "type" in value) {
      // Extended form: { type: "string", description: "...", enum: [...] }
      const ext = value as Record<string, unknown>;
      const typeStr = String(ext.type);
      const optional = typeStr.endsWith("?");
      const typeName = optional ? typeStr.slice(0, -1) : typeStr;

      const prop: Record<string, unknown> = { type: typeName };
      if (ext.description) prop.description = ext.description;
      if (ext.enum) prop.enum = ext.enum;

      properties[key] = prop;
      if (!optional) required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

/**
 * Convert tool definitions from customer configure message to OpenAI tool schemas.
 */
export function toolDefsToSchemas(tools: ToolDef[]): ToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toJsonSchema(t.parameters),
  }));
}
