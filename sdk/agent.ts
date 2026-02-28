// agent.ts — Agent SDK class with chainable .tool(), .routes(), and .serve().
//
// Inspired by Fresh 2's App() and Hono's chainable builder pattern.
// Each agent is a standalone Deno server that imports this class.

import { z } from "zod";
import type { ToolContext, ToolHandler } from "./tool-executor.ts";

export type { ToolContext };

export interface AgentOptions {
  name: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}

export interface ToolDef<
  T extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  description: string;
  parameters: T;
  handler: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown> | unknown;
}

/**
 * Internal representation of a tool after registration.
 * The handler accepts `Record<string, unknown>` because Zod validation
 * guarantees correctness at runtime before the handler is called.
 */
export interface StoredToolDef {
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

/**
 * A voice agent definition with chainable .tool() builder,
 * .routes() for Hono composability, and .serve() for standalone mode.
 *
 * @example
 * ```ts
 * import { Agent, z } from "../../mod.ts";
 *
 * const agent = new Agent({
 *   name: "Coda",
 *   instructions: "You are a code assistant...",
 *   greeting: "Hi!",
 *   voice: "dan",
 * }).tool("run_code", {
 *   description: "Execute JavaScript",
 *   parameters: z.object({ code: z.string().describe("JS code") }),
 *   handler: async ({ code }) => eval(code),
 * });
 *
 * export default agent;
 * ```
 */
export class Agent {
  readonly config: AgentOptions;
  readonly tools = new Map<string, StoredToolDef>();

  constructor(config: AgentOptions) {
    this.config = config;
  }

  /** Register a tool (chainable). Handler args are typed from the Zod schema. */
  tool<T extends z.ZodObject<z.ZodRawShape>>(
    name: string,
    def: ToolDef<T>,
  ): this {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    // Safe: Zod validates args at runtime before handler is called.
    // The handler accepts z.infer<T> which is a subtype of Record<string, unknown>.
    this.tools.set(name, {
      description: def.description,
      parameters: def.parameters,
      handler: def.handler as StoredToolDef["handler"],
    });
    return this;
  }

  /** Get tool handlers as a Map<string, ToolHandler> for the ToolExecutor. */
  getToolHandlers(): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();
    for (const [name, def] of this.tools) {
      handlers.set(name, { schema: def.parameters, handler: def.handler });
    }
    return handlers;
  }

  /**
   * Create a Hono app with all agent routes.
   * Composable with other Hono apps:
   * ```ts
   * const agentApp = await agent.routes();
   * app.route("/", agentApp);
   * ```
   */
  async routes(
    opts?: { secrets?: Record<string, string>; clientDir?: string },
  ) {
    const { createAgentApp } = await import("./server.ts");
    const { loadPlatformConfig } = await import("./config.ts");

    const platformConfig = loadPlatformConfig(Deno.env.toObject());
    return createAgentApp({
      agent: this,
      secrets: opts?.secrets ?? Deno.env.toObject(),
      platformConfig,
      clientDir: opts?.clientDir,
    });
  }

  /** Start serving this agent. */
  async serve(
    opts?: { port?: number; clientDir?: string },
  ): Promise<Deno.HttpServer> {
    // Load .env from agent directory (best-effort)
    try {
      const { load } = await import("@std/dotenv");
      await load({ export: true });
    } catch {
      // .env not found or @std/dotenv not available — that's fine
    }

    const app = await this.routes({
      clientDir: opts?.clientDir ?? Deno.env.get("CLIENT_DIR"),
    });
    const port = opts?.port ?? parseInt(Deno.env.get("PORT") ?? "3000");

    const server = Deno.serve({ port }, app.fetch);
    console.log(`${this.config.name} listening on http://localhost:${port}`);
    return server;
  }
}
