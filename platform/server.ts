import { Hono } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import type { PlatformConfig } from "./config.ts";
import { applyMiddleware } from "./middleware.ts";
import { renderAgentPage } from "./html.ts";
import { favicon } from "./routes/favicon.ts";
import { createHealthRoute } from "./routes/health.ts";
import { createServerSession } from "./session_factory.ts";
import { agentToolsToSchemas } from "./protocol.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import { createToolExecutor } from "./tool_executor.ts";
import { ServerSession, type SessionDeps } from "./session.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import { type AgentDef, toToolHandlers } from "../sdk/agent.ts";

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
