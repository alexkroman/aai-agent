// sandbox.ts — V8 isolate manager for tool handler execution.
//
// Runs customer-provided tool handler functions in an isolated V8 context
// with injected ctx.secrets and ctx.fetch. Each execution gets a fresh
// context so tool calls cannot leak state to each other.

import ivm from "isolated-vm";
import { ISOLATE_MEMORY_LIMIT_MB, TIMEOUTS } from "./constants.js";
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

  constructor(tools: { name: string; handler: string }[], secrets: Record<string, string>) {
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
  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return ERR_INTERNAL.TOOL_UNKNOWN(toolName);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUTS.TOOL_HANDLER);
    let context: ivm.Context | null = null;

    try {
      context = await this.isolate.createContext();

      // Inject a host-side fetch function as a Reference on the context global.
      // The isolate calls it via applySyncPromise which blocks the isolate
      // thread while the host performs the async HTTP request.
      const fetchRef = new ivm.Reference(async (url: string, initJson: string): Promise<string> => {
        const init = initJson ? JSON.parse(initJson) : {};
        const resp = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        const body = await resp.text();
        return JSON.stringify({
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          headers: Object.fromEntries(resp.headers.entries()),
          body,
        });
      });
      context.global.setSync("__fetchRef", fetchRef);

      // The evalClosure code:
      // 1. Captures the fetch Reference and removes it from globals
      // 2. Builds a ctx object with secrets and fetch
      // 3. Executes the handler with args and ctx
      // 4. Stringifies non-string results
      //
      // $0 = secrets (ExternalCopy), $1 = args (ExternalCopy)
      // Handler source is embedded directly in the code string.
      const code = `
        return (async () => {
          const __fr = globalThis.__fetchRef;
          delete globalThis.__fetchRef;

          const ctx = {
            secrets: $0,
            fetch: (url, init) => {
              const raw = __fr.applySyncPromise(
                undefined,
                [String(url), init ? JSON.stringify(init) : '']
              );
              const r = JSON.parse(raw);
              return {
                ok: r.ok,
                status: r.status,
                statusText: r.statusText,
                headers: r.headers,
                text: () => r.body,
                json: () => JSON.parse(r.body),
              };
            },
          };

          const fn = (${handler.source});
          const result = await fn($1, ctx);
          if (result === undefined || result === null) return 'null';
          return typeof result === 'string' ? result : JSON.stringify(result);
        })();
      `;

      const result = await context.evalClosure(
        code,
        [
          new ivm.ExternalCopy({ ...this.secrets }).copyInto(),
          new ivm.ExternalCopy(args).copyInto(),
        ],
        {
          timeout: TIMEOUTS.TOOL_HANDLER,
          result: { promise: true, copy: true },
        }
      );

      return (result as string) ?? "null";
    } catch (err) {
      if (controller.signal.aborted) {
        return ERR_INTERNAL.TOOL_TIMEOUT(toolName, TIMEOUTS.TOOL_HANDLER);
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timeout);
      try {
        context?.release();
      } catch (err) {
        console.warn("[sandbox] Context release failed:", err);
      }
    }
  }

  /**
   * Dispose of the V8 isolate and free resources.
   */
  dispose(): void {
    try {
      this.isolate.dispose();
    } catch (err) {
      console.warn("[sandbox] Isolate dispose failed:", err);
    }
  }
}
