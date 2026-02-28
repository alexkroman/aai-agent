// protocol.ts — Zod→JSON Schema conversion and tool schema helpers.

import { z } from "zod";
import type { ToolSchema } from "./types.ts";
import type { ToolDef } from "../sdk/agent.ts";

/**
 * Convert a single Zod type to a JSON Schema fragment.
 * Handles: ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray,
 * ZodOptional, ZodDefault, ZodObject (nested), plus .describe().
 */
function zodTypeToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def;

  // Unwrap wrappers, preserving outer description
  if (def.typeName === "ZodOptional") {
    const inner = zodTypeToJsonSchema(def.innerType);
    if (schema.description && !inner.description) {
      inner.description = schema.description;
    }
    return inner;
  }
  if (def.typeName === "ZodDefault") {
    const inner = zodTypeToJsonSchema(def.innerType);
    if (schema.description && !inner.description) {
      inner.description = schema.description;
    }
    return inner;
  }

  const result: Record<string, unknown> = {};
  if (schema.description) result.description = schema.description;

  switch (def.typeName) {
    case "ZodString":
      result.type = "string";
      break;
    case "ZodNumber":
      result.type = "number";
      break;
    case "ZodBoolean":
      result.type = "boolean";
      break;
    case "ZodEnum":
      result.type = "string";
      result.enum = def.values;
      break;
    case "ZodArray":
      result.type = "array";
      result.items = zodTypeToJsonSchema(def.type);
      break;
    case "ZodObject": {
      result.type = "object";
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodTypeToJsonSchema(value);
        if (!value.isOptional()) {
          required.push(key);
        }
      }
      result.properties = properties;
      if (required.length > 0) result.required = required;
      break;
    }
  }

  return result;
}

/**
 * Convert a Zod object schema to JSON Schema.
 */
export function zodToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  return zodTypeToJsonSchema(schema);
}

/**
 * Convert Agent tool definitions to OpenAI tool schemas.
 */
export function agentToolsToSchemas(
  tools: Map<string, ToolDef>,
): ToolSchema[] {
  const schemas: ToolSchema[] = [];
  for (const [name, def] of tools) {
    schemas.push({
      name,
      description: def.description,
      parameters: zodToJsonSchema(def.parameters),
    });
  }
  return schemas;
}
