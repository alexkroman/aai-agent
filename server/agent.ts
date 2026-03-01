import { Hono } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import type { PlatformConfig } from "./config.ts";
import { applyMiddleware } from "./middleware.ts";
import { renderAgentPage } from "../ui/html.ts";
import { favicon } from "./routes/favicon.ts";
import { createHealthRoute } from "./routes/health.ts";
import { agentToolsToSchemas } from "./protocol.ts";
import { createToolExecutor, toToolHandlers } from "./tool_executor.ts";
import { ServerSession } from "./session.ts";
import { handleSessionWebSocket, type Session } from "./ws_handler.ts";
import {
  type AgentOptions,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  type ToolDef,
} from "./agent_types.ts";

/**
 * A voice agent that doubles as an HTTP server handler.
 *
 * @example Simple — export as default, let the CLI serve it
 * ```ts
 * import { Agent } from "@aai/sdk";
 *
 * export default new Agent({
 *   name: "Scout",
 *   voice: "tara",
 *   instructions: "...",
 * });
 * ```
 *
 * @example Self-serving
 * ```ts
 * agent.serve({ port: 3000 });
 * ```
 *
 * @example Composable with custom routes
 * ```ts
 * Deno.serve((req) => {
 *   const url = new URL(req.url);
 *   if (url.pathname === "/api/custom") return new Response("custom");
 *   return agent.fetch(req);
 * });
 * ```
 */
export class Agent {
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly string[];
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];

  readonly #sessions = new Map<string, Session>();
  #platform:
    | { secrets: Record<string, string>; config: PlatformConfig }
    | null = null;
  #app: Hono;

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
    this.greeting = options.greeting ?? DEFAULT_GREETING;
    this.voice = options.voice ?? "jess";
    this.prompt = options.prompt;
    this.builtinTools = options.builtinTools;
    this.tools = options.tools ?? {};
    this.onConnect = options.onConnect;
    this.onDisconnect = options.onDisconnect;
    this.onError = options.onError;
    this.onTurn = options.onTurn;
    this.#app = this.#buildApp();
  }

  /** Standard `Request → Response` handler. */
  fetch = (req: Request): Response | Promise<Response> => {
    return this.#app.fetch(req);
  };

  /** WebSocket upgrade for embedding in a custom server. */
  upgrade(req: Request): Response {
    const upgrade = req.headers.get("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    this.#handleWs(socket);
    return response;
  }

  /** Start serving on the given port. Loads .env automatically. */
  async serve(
    opts?: { port?: number; clientDir?: string },
  ): Promise<Deno.HttpServer> {
    try {
      const { load } = await import("@std/dotenv");
      await load({ export: true });
    } catch {
      // .env not found — that's fine
    }

    const clientDir = opts?.clientDir ?? Deno.env.get("CLIENT_DIR");
    if (clientDir) {
      this.#app = this.#buildApp(clientDir);
    }

    const port = opts?.port ?? parseInt(Deno.env.get("PORT") ?? "3000");
    const server = Deno.serve({ port }, this.fetch);
    console.log(`${this.name} listening on http://localhost:${port}`);
    return server;
  }

  async #handleWs(socket: WebSocket): Promise<void> {
    const { getBuiltinToolSchemas } = await import("./builtin_tools.ts");
    const toolSchemas = [
      ...agentToolsToSchemas(this.tools),
      ...getBuiltinToolSchemas([...(this.builtinTools ?? [])]),
    ];

    const { secrets, config } = await this.#loadPlatform();

    handleSessionWebSocket(socket, this.#sessions, {
      createSession: (sessionId, ws) => {
        const agentConfig = {
          instructions: this.instructions,
          greeting: this.greeting,
          voice: this.voice,
          prompt: this.prompt,
          builtinTools: this.builtinTools ? [...this.builtinTools] : undefined,
        };
        const executeTool = createToolExecutor(
          toToolHandlers(this.tools),
          secrets,
        );
        return ServerSession.create(sessionId, ws, agentConfig, toolSchemas, {
          platformConfig: config,
          executeTool,
          secrets,
        });
      },
    });
  }

  async #loadPlatform(): Promise<{
    secrets: Record<string, string>;
    config: PlatformConfig;
  }> {
    if (!this.#platform) {
      const { loadPlatformConfig } = await import("./config.ts");
      const env = Deno.env.toObject();
      this.#platform = {
        config: loadPlatformConfig(env),
        secrets: env,
      };
    }
    return this.#platform;
  }

  #buildApp(clientDir?: string): Hono {
    const app = new Hono();
    applyMiddleware(app);
    app.route("/", createHealthRoute());
    app.route("/", favicon);

    app.get("/session", (c) => {
      if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return c.text("Expected WebSocket upgrade", 400);
      }

      const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
      this.#handleWs(socket);
      return response;
    });

    app.get("/", (c) => c.html(renderAgentPage(this.name)));

    if (clientDir) {
      app.use("/*", serveStatic({ root: clientDir }));
    }

    return app;
  }
}
