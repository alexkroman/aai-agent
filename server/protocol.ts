// Tool schema helpers using Zod's built-in JSON Schema conversion.

import { z } from "zod";
import type { ToolSchema } from "./types.ts";
import type { ToolDef } from "./agent_types.ts";

/**
 * Convert Agent tool definitions to OpenAI tool schemas.
 */
export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  const schemas: ToolSchema[] = [];
  for (const [name, def] of Object.entries(tools)) {
    schemas.push({
      name,
      description: def.description,
      parameters: z.toJSONSchema(def.parameters) as Record<string, unknown>,
    });
  }
  return schemas;
}
