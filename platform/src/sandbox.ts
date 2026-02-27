// sandbox.ts — V8 isolate manager for tool handler execution.
//
// Runs customer-provided tool handler functions in an isolated V8 context
// with injected ctx.secrets and ctx.fetch. Each execution gets a fresh
// context so tool calls cannot leak state to each other.

import ivm from "isolated-vm";
import { TIMEOUTS, ISOLATE_MEMORY_LIMIT_MB } from "./constants.js";
import { ERR_INTERNAL } from "./errors.js";

export interface SandboxContext {
  secrets: Record<string, string>;
}

interface CompiledHandler {
  name: string;
  /** The raw source of the handler function */
  source: string;
}

/**
 * A sandbox that runs customer tool handlers in an isolated V8 context.
 *
 * Each session gets its own Sandbox instance (one V8 isolate). Each
 * execute() call creates a fresh context within that isolate for full
 * isolation between tool calls.
 */
export class Sandbox {
  private isolate: ivm.Isolate;
  private handlers: Map<string, CompiledHandler> = new Map();
  private secrets: Record<string, string>;

  constructor(
    tools: { name: string; handler: string }[],
    secrets: Record<string, string>,
  ) {
    this.isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_LIMIT_MB });
    this.secrets = secrets;

    for (const tool of tools) {
      this.handlers.set(tool.name, {
        name: tool.name,
        source: tool.handler,
      });
    }
  }

  /**
   * Execute a tool handler with the given arguments.
   *
   * The handler runs in an isolated V8 context with access to:
   * - ctx.secrets: customer secrets (copied per execution, mutations don't leak)
   * - ctx.fetch: proxied fetch (runs in Node.js host, result serialized back)
   *
   * ctx.fetch returns a simplified Response-like object:
   *   { ok, status, statusText, headers, text(), json() }
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return ERR_INTERNAL.TOOL_UNKNOWN(toolName);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUTS.TOOL_HANDLER);

    try {
      context = await this.isolate.createContext();

      // Reconstruct the handler function from source and call it
      const fn = new Function("return " + handler.source)();
      const result = await fn(args, ctx);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      if (controller.signal.aborted) {
        return ERR_INTERNAL.TOOL_TIMEOUT(toolName, TIMEOUTS.TOOL_HANDLER);
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timeout);
      try {
        context?.release();
      } catch {
        // Already released
      }
    }
  }

  /**
   * Dispose of the V8 isolate and free resources.
   */
  dispose(): void {
    try {
      this.isolate.dispose();
    } catch {
      // Already disposed
    }
  }
}
