// tool-executor.ts — In-process tool execution with Zod validation.
//
// Runs agent tool handlers directly in the Deno process. No serialization,
// no V8 isolate, no IPC. Handlers are trusted server-side code.
// Validates arguments against the tool's Zod schema before calling the handler.

import { z } from "zod";
import { createLogger } from "./logger.ts";

const log = createLogger("tool-executor");

const TOOL_TIMEOUT_MS = 30_000;

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

/**
 * Executes tool handlers in-process with Zod validation and a timeout.
 */
export class ToolExecutor {
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

    // Validate args with Zod schema
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      const errors = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      return `Error: Invalid arguments for tool "${name}": ${errors}`;
    }

    try {
      const ctx: ToolContext = {
        secrets: { ...this.secrets },
        fetch: globalThis.fetch,
      };
      const result = await Promise.race([
        tool.handler(parsed.data as Record<string, unknown>, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Tool "${name}" timed out after ${TOOL_TIMEOUT_MS}ms`,
                ),
              ),
            TOOL_TIMEOUT_MS,
          )
        ),
      ]);
      if (result === null || result === undefined) return "null";
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      log.warn({ err, tool: name }, "Tool execution failed");
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  dispose(): void {
    // noop — no isolate to clean up
  }
}
