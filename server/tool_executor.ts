import { getLogger } from "../_utils/logger.ts";
import type { ToolContext, ToolDef, ToolHandler } from "./agent_types.ts";

const log = getLogger("tool-executor");
export const TOOL_HANDLER_TIMEOUT = 30_000;

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolHandler,
  secrets: Record<string, string>,
): Promise<string> {
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    return `Error: Invalid arguments for tool "${name}": ${errors}`;
  }

  try {
    const signal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const ctx: ToolContext = {
      secrets: { ...secrets },
      fetch: globalThis.fetch,
      signal,
    };
    const result = await Promise.resolve(
      tool.handler(parsed.data as Record<string, unknown>, ctx),
    );
    if (result == null) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      log.warn("Tool execution timed out", { tool: name });
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    log.warn("Tool execution failed", { err, tool: name });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function createToolExecutor(
  tools: Map<string, ToolHandler>,
  secrets: Record<string, string>,
): ExecuteTool {
  return (name, args) => {
    const tool = tools.get(name);
    if (!tool) return Promise.resolve(`Error: Unknown tool "${name}"`);
    return executeToolCall(name, args, tool, secrets);
  };
}

export function toToolHandlers(
  tools: Readonly<Record<string, ToolDef>>,
): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const [name, def] of Object.entries(tools)) {
    handlers.set(name, {
      schema: def.parameters,
      handler: def.handler as ToolHandler["handler"],
    });
  }
  return handlers;
}
