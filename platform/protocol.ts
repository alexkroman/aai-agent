// protocol.ts — Tool schema helpers using Zod's built-in JSON Schema conversion.

import { z } from "zod";
import type { ToolSchema } from "./types.ts";
import type { StoredToolDef } from "../sdk/agent.ts";

/**
 * Convert a Zod object schema to JSON Schema.
 */
export function zodToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

/**
 * Convert Agent tool definitions to OpenAI tool schemas.
 */
export function agentToolsToSchemas(
  tools: Map<string, StoredToolDef>,
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
