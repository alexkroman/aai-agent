// tool-executor.ts — In-process tool execution with Zod validation.
//
// Runs agent tool handlers directly in the Deno process. No serialization,
// no V8 isolate, no IPC. Handlers are trusted server-side code.
// Validates arguments against the tool's Zod schema before calling the handler.

import { z } from "zod";
import { deadline } from "@std/async/deadline";
import { TIMEOUTS } from "./shared-protocol.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("tool-executor");

export interface ToolHandler {
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

export interface ToolContext {
  secrets: Record<string, string>;
  fetch: typeof globalThis.fetch;
}

/** Interface for tool execution — satisfied by ToolExecutor and WorkerToolExecutor. */
export interface IToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<string>;
  dispose(): void;
}

/**
 * Execute a single tool call with Zod validation, timeout, and result serialization.
 * Shared by ToolExecutor (in-process) and worker-entry (Worker).
 */
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
    const ctx: ToolContext = {
      secrets: { ...secrets },
      fetch: globalThis.fetch,
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

/**
 * Executes tool handlers in-process with Zod validation and a timeout.
 */
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

  dispose(): void {
    // noop — no isolate to clean up
  }
}
