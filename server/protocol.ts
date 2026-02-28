import { z } from "zod";
import type { ToolSchema } from "./types.ts";
import type { ToolDef } from "./agent_types.ts";

export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: z.toJSONSchema(def.parameters) as Record<string, unknown>,
  }));
}
