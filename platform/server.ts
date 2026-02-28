import { Hono } from "@hono/hono";
import type { PlatformConfig } from "./config.ts";
import { applyMiddleware } from "./middleware.ts";
import { renderAgentPage } from "./html.ts";
import { favicon } from "./routes/favicon.ts";
import { createHealthRoute } from "./routes/health.ts";
import { createServerSession } from "./session-factory.ts";
import { agentToolsToSchemas } from "./protocol.ts";
import { getBuiltinToolSchemas } from "./builtin-tools.ts";
import { ToolExecutor } from "./tool-executor.ts";
import { type SessionDeps, ServerSession } from "./session.ts";
import { handleSessionWebSocket } from "./ws-handler.ts";
import { typeByExtension } from "@std/media-types";
import { createLogger } from "../sdk/logger.ts";
import type { Agent } from "../sdk/agent.ts";

const log = createLogger("server");

export interface ServerHandlerOptions {
  agent: Agent;
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
      ...getBuiltinToolSchemas(options.agent.config.builtinTools ?? []),
    ];

    handleSessionWebSocket(socket, sessions, {
      createSession: (sessionId, ws) => {
        const agentConfig = {
          instructions: options.agent.config.instructions,
          greeting: options.agent.config.greeting,
          voice: options.agent.config.voice,
          prompt: options.agent.config.prompt,
          builtinTools: options.agent.config.builtinTools,
        };
        const toolExecutor = new ToolExecutor(
          options.agent.getToolHandlers(),
          options.secrets,
        );
        return createServerSession(sessionId, ws, agentConfig, toolSchemas, {
          platformConfig: options.platformConfig,
          toolExecutor,
          depsOverride: options.sessionDepsOverride,
        });
      },
    });
    return response;
  });

  app.get("/", (c) => c.html(renderAgentPage(options.agent.config.name)));

  if (options.clientDir) {
    const clientDir = options.clientDir;
    app.get("/*", async (c) => {
      const pathname = c.req.path.slice(1);
      const ext = pathname.split(".").pop() ?? "";
      const mime = typeByExtension(ext);
      if (mime) {
        try {
          const filePath = `${clientDir}/${pathname}`;
          const content = await Deno.readFile(filePath);
          return c.body(content, {
            headers: {
              "Content-Type": mime,
              "Cache-Control": "no-cache",
            },
          });
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) {
            log.warn({ err, pathname }, "Unexpected error reading file");
          }
        }
      }
      return c.text("Not found", 404);
    });
  }

  return app;
}
