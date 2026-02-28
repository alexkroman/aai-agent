import { deadline } from "@std/async/deadline";
import { TIMEOUTS } from "../sdk/shared_protocol.ts";
import { createLogger } from "../sdk/logger.ts";
import type { ToolContext, ToolHandler } from "../sdk/tool_executor.ts";

const log = createLogger("tool-executor");

/** Interface for tool execution — satisfied by ToolExecutor and ComlinkToolExecutor. */
export interface IToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<string>;
  dispose(): void;
}

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
    const signal = AbortSignal.timeout(TIMEOUTS.TOOL_HANDLER);
    const ctx: ToolContext = {
      secrets: { ...secrets },
      fetch: globalThis.fetch,
      signal,
    };
    const result = await deadline(
      Promise.resolve(
        tool.handler(parsed.data as Record<string, unknown>, ctx),
      ),
      TIMEOUTS.TOOL_HANDLER,
    );
    if (result === null || result === undefined) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      log.warn({ tool: name }, "Tool execution timed out");
      return `Error: Tool "${name}" timed out after ${TIMEOUTS.TOOL_HANDLER}ms`;
    }
    log.warn({ err, tool: name }, "Tool execution failed");
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export class ToolExecutor implements IToolExecutor {
  private tools: Map<string, ToolHandler>;
  private secrets: Record<string, string>;

  constructor(
    tools: Map<string, ToolHandler>,
    secrets: Record<string, string>,
  ) {
    this.tools = tools;
    this.secrets = secrets;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: Unknown tool "${name}"`;
    return await executeToolCall(name, args, tool, this.secrets);
  }

  dispose(): void {}
}
