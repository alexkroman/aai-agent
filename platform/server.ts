import { Hono } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import { loadPlatformConfig, type PlatformConfig } from "./config.ts";
import { applyMiddleware } from "./middleware.ts";
import { renderAgentPage } from "./html.ts";
import { favicon } from "./routes/favicon.ts";
import { createHealthRoute } from "./routes/health.ts";
import { createServerSession } from "./session_factory.ts";
import { agentToolsToSchemas } from "./protocol.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import { createToolExecutor, toToolHandlers } from "./tool_executor.ts";
import { ServerSession, type SessionDeps } from "./session.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import type { AgentDef } from "../sdk/agent.ts";

export interface ServerHandlerOptions {
  agent: AgentDef;
  secrets: Record<string, string>;
  platformConfig: PlatformConfig;
  clientDir?: string;
  sessionDepsOverride?: Partial<SessionDeps>;
}

export function createAgentApp(options: ServerHandlerOptions): Hono {
  const app = new Hono();
  const sessions = new Map<string, ServerSession>();

  applyMiddleware(app);
  app.route("/", createHealthRoute());
  app.route("/", favicon);

  app.get("/session", (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected WebSocket upgrade", 400);
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

    const toolSchemas = [
      ...agentToolsToSchemas(options.agent.tools),
      ...getBuiltinToolSchemas([...(options.agent.builtinTools ?? [])]),
    ];

    handleSessionWebSocket(socket, sessions, {
      createSession: (sessionId, ws) => {
        const agentConfig = {
          instructions: options.agent.instructions,
          greeting: options.agent.greeting,
          voice: options.agent.voice,
          prompt: options.agent.prompt,
          builtinTools: options.agent.builtinTools
            ? [...options.agent.builtinTools]
            : undefined,
        };
        const executeTool = createToolExecutor(
          toToolHandlers(options.agent.tools),
          options.secrets,
        );
        return createServerSession(sessionId, ws, agentConfig, toolSchemas, {
          platformConfig: options.platformConfig,
          executeTool,
          depsOverride: options.sessionDepsOverride,
        });
      },
    });
    return response;
  });

  app.get("/", (c) => c.html(renderAgentPage(options.agent.name)));

  if (options.clientDir) {
    app.use("/*", serveStatic({ root: options.clientDir }));
  }

  return app;
}

/**
 * Create a Hono app with all agent routes.
 * Composable with other Hono apps:
 * ```ts
 * const agentApp = await routes(agent);
 * app.route("/", agentApp);
 * ```
 */
export function routes(
  agent: AgentDef,
  opts?: { secrets?: Record<string, string>; clientDir?: string },
) {
  const platformConfig = loadPlatformConfig(Deno.env.toObject());
  return createAgentApp({
    agent,
    secrets: opts?.secrets ?? Deno.env.toObject(),
    platformConfig,
    clientDir: opts?.clientDir,
  });
}

/** Start serving an agent on the given port. */
export async function serve(
  agent: AgentDef,
  opts?: { port?: number; clientDir?: string },
): Promise<Deno.HttpServer> {
  try {
    const { load } = await import("@std/dotenv");
    await load({ export: true });
  } catch {
    // .env not found — that's fine
  }

  const app = routes(agent, {
    clientDir: opts?.clientDir ?? Deno.env.get("CLIENT_DIR"),
  });
  const port = opts?.port ?? parseInt(Deno.env.get("PORT") ?? "3000");

  const server = Deno.serve({ port }, app.fetch);
  console.log(`${agent.name} listening on http://localhost:${port}`);
  return server;
}
