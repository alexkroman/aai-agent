// Identity function that preserves the generic type for tool parameter inference.

import type { ToolDef } from "./agent_types.ts";
import { z } from "zod";

export function tool<T extends z.ZodObject<z.ZodRawShape>>(
  def: ToolDef<T>,
): ToolDef<T> {
  return def;
}
