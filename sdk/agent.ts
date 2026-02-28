// agent.ts — Agent class: the core primitive for building voice agent apps.
//
// Chainable builder with .tool(), lifecycle hooks, and Deno-native serving.

import { z } from "zod";
import type { ToolContext, ToolHandler } from "./tool-executor.ts";
import {
  type ConnectHandler,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  type DisconnectHandler,
  type ErrorHandler,
  type TurnHandler,
} from "./types.ts";

export type { ToolContext };

export interface AgentOptions {
  /** Display name for this agent. */
  name: string;
  /** System prompt / instructions for the LLM. */
  instructions?: string;
  /** Initial greeting spoken when a session starts. */
  greeting?: string;
  /** TTS voice name (e.g., "dan", "jess", "luna"). */
  voice?: string;
  /** Optional transcription prompt to guide STT. */
  prompt?: string;
  /** Names of built-in server-side tools to enable (e.g., ["web_search"]). */
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

/** Lifecycle hook storage. */
export interface AgentHooks {
  onConnect?: ConnectHandler;
  onDisconnect?: DisconnectHandler;
  onError?: ErrorHandler;
  onTurn?: TurnHandler;
}

/**
 * A voice agent definition with chainable builder API.
 *
 * @example
 * ```ts
 * import { Agent, z } from "@aai/sdk";
 *
 * export const agent = new Agent({
 *   name: "Coda",
 *   instructions: "You are a code assistant.",
 *   voice: "dan",
 * })
 * .tool("run_code", {
 *   description: "Execute JavaScript",
 *   parameters: z.object({ code: z.string().describe("JS code") }),
 *   handler: async ({ code }) => eval(code),
 * })
 * .onConnect(({ sessionId }) => {
 *   console.log(`Session ${sessionId} started`);
 * });
 * ```
 */
export class Agent {
  readonly config:
    & Required<
      Pick<AgentOptions, "name" | "instructions" | "greeting" | "voice">
    >
    & Pick<AgentOptions, "prompt" | "builtinTools">;
  readonly tools = new Map<string, StoredToolDef>();
  readonly hooks: AgentHooks = {};

  constructor(options: AgentOptions) {
    this.config = {
      name: options.name,
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
      greeting: options.greeting ?? DEFAULT_GREETING,
      voice: options.voice ?? "jess",
      prompt: options.prompt,
      builtinTools: options.builtinTools,
    };
  }

  /** Register a tool (chainable). Handler args are typed from the Zod schema. */
  tool<T extends z.ZodObject<z.ZodRawShape>>(
    name: string,
    def: ToolDef<T>,
  ): this {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, {
      description: def.description,
      parameters: def.parameters,
      handler: def.handler as StoredToolDef["handler"],
    });
    return this;
  }

  /** Called when a new voice session connects. */
  onConnect(handler: ConnectHandler): this {
    this.hooks.onConnect = handler;
    return this;
  }

  /** Called when a voice session disconnects. */
  onDisconnect(handler: DisconnectHandler): this {
    this.hooks.onDisconnect = handler;
    return this;
  }

  /** Called when an error occurs during a session. */
  onError(handler: ErrorHandler): this {
    this.hooks.onError = handler;
    return this;
  }

  /** Called when a user completes a speech turn. */
  onTurn(handler: TurnHandler): this {
    this.hooks.onTurn = handler;
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
    const { createAgentApp } = await import("../platform/server.ts");
    const { loadPlatformConfig } = await import("../platform/config.ts");

    const platformConfig = loadPlatformConfig(Deno.env.toObject());
    return createAgentApp({
      agent: this,
      secrets: opts?.secrets ?? Deno.env.toObject(),
      platformConfig,
      clientDir: opts?.clientDir,
    });
  }

  /** Start serving this agent on the given port. */
  async serve(
    opts?: { port?: number; clientDir?: string },
  ): Promise<Deno.HttpServer> {
    try {
      const { load } = await import("@std/dotenv");
      await load({ export: true });
    } catch {
      // .env not found — that's fine
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
