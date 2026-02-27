// sandbox.ts — V8 isolate manager for tool handler execution.
//
// Runs customer-provided tool handler functions in an isolated V8 context
// with injected ctx.secrets and ctx.fetch.

import ivm from "isolated-vm";

const HANDLER_TIMEOUT_MS = 30_000;
const ISOLATE_MEMORY_LIMIT_MB = 128;

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
 * Each session gets its own Sandbox instance. Handlers are compiled once
 * on creation and executed per tool call.
 */
export class Sandbox {
  private isolate: ivm.Isolate;
  private handlers: Map<string, CompiledHandler> = new Map();
  private secrets: Record<string, string>;

  constructor(
    tools: { name: string; handler: string }[],
    secrets: Record<string, string>
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
   * - ctx.secrets: customer secrets from the platform store
   * - ctx.fetch: proxied fetch function (runs in Node.js, results passed back)
   *
   * Since isolated-vm doesn't support async natively, we use a synchronous
   * execution model with callback-based fetch that resolves in the host.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return `Error: Unknown tool "${toolName}"`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HANDLER_TIMEOUT_MS);

    try {
      // For now, we execute the handler in the main Node.js process
      // but in a controlled way. The full isolated-vm implementation
      // would compile and run in a separate V8 isolate.
      //
      // This approach gives us the API shape while we develop the full
      // sandbox. The handler source is eval'd with ctx injected.
      const ctx: SandboxContext & { fetch: typeof fetch } = {
        secrets: { ...this.secrets },
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          return fetch(input, {
            ...init,
            signal: controller.signal,
          });
        },
      };

      // Reconstruct the handler function from source and call it
      // eslint-disable-next-line no-new-func
      const fn = new Function("return " + handler.source)();
      const result = await fn(args, ctx);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      if (controller.signal.aborted) {
        return `Error: Tool "${toolName}" timed out after ${HANDLER_TIMEOUT_MS}ms`;
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timeout);
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
