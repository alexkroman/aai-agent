// server.ts — Hono-based HTTP/WS handler factory, called by Agent.serve().
// Deno-native: uses Deno.serve(), Deno.upgradeWebSocket(), standard WebSocket API.

import { Hono } from "@hono/hono";
import { compress } from "@hono/hono/compress";
import { cors } from "@hono/hono/cors";
import type { PlatformConfig } from "./config.ts";
import { callLLM } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { agentToolsToSchemas } from "./protocol.ts";
import { ToolExecutor } from "./tool-executor.ts";
import { connectStt } from "./stt.ts";
import { TtsClient } from "./tts.ts";
import { executeBuiltinTool, getBuiltinToolSchemas } from "./builtin-tools.ts";
import { type SessionDeps, VoiceSession } from "./session.ts";
import { normalizeVoiceText } from "./voice-cleaner.ts";
import { handleSessionWebSocket } from "./ws-handler.ts";
import { typeByExtension } from "@std/media-types";
import type { Agent } from "./agent.ts";

const log = createLogger("server");

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#2196F3"/><path d="M50 25c-6 0-11 5-11 11v14c0 6 5 11 11 11s11-5 11-11V36c0-6-5-11-11-11z" fill="white"/><path d="M71 50c0 11-9 21-21 21s-21-10-21-21h-6c0 14 10 25 24 27v8h6v-8c14-2 24-13 24-27h-6z" fill="white"/></svg>`;

/** Options passed to createAgentApp by Agent.serve(). */
export interface ServerHandlerOptions {
  agent: Agent;
  secrets: Record<string, string>;
  platformConfig: PlatformConfig;
  clientDir?: string;
  /** Injectable overrides for session deps (for testing). */
  sessionDepsOverride?: Partial<SessionDeps>;
}

/** Generate the agent HTML page. basePath is "" for standalone, "/:slug" for orchestrator. */
export function renderAgentPage(
  name: string,
  basePath = "",
): string {
  const safeName = escapeHtml(name);
  const safePath = escapeHtml(basePath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    const { VoiceAgent } = await import("${safePath}/client.js");
    VoiceAgent.start({ element: "#app", platformUrl: window.location.origin + "${safePath}" });
  </script>
</body>
</html>`;
}

/**
 * Create a Hono app for the agent.
 * Handles HTTP routes and WebSocket upgrades.
 */
export function createAgentApp(options: ServerHandlerOptions): Hono {
  const app = new Hono();
  const sessions = new Map<string, VoiceSession>();

  // CORS + gzip compression
  app.use("*", cors());
  app.use("*", compress());

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Favicon
  app.get("/favicon.ico", (c) =>
    c.body(FAVICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    }));
  app.get("/favicon.svg", (c) =>
    c.body(FAVICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    }));

  // WebSocket upgrade: /session
  app.get("/session", (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected WebSocket upgrade", 400);
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    handleSessionWebSocket(socket, sessions, {
      createSession: (sessionId, ws) => {
        const agentConfig = {
          instructions: options.agent.config.instructions,
          greeting: options.agent.config.greeting,
          voice: options.agent.config.voice,
          prompt: options.agent.config.prompt,
          builtinTools: options.agent.config.builtinTools,
        };
        const toolSchemas = [
          ...agentToolsToSchemas(options.agent.tools),
          ...getBuiltinToolSchemas(options.agent.config.builtinTools ?? []),
        ];
        const deps: SessionDeps = {
          config: {
            ...options.platformConfig,
            ttsConfig: { ...options.platformConfig.ttsConfig },
          },
          connectStt: options.sessionDepsOverride?.connectStt ?? connectStt,
          callLLM: options.sessionDepsOverride?.callLLM ?? callLLM,
          ttsClient: options.sessionDepsOverride?.ttsClient ??
            new TtsClient(options.platformConfig.ttsConfig),
          toolExecutor: options.sessionDepsOverride?.toolExecutor ??
            new ToolExecutor(
              options.agent.getToolHandlers(),
              options.secrets,
            ),
          normalizeVoiceText: options.sessionDepsOverride?.normalizeVoiceText ??
            normalizeVoiceText,
          executeBuiltinTool: options.sessionDepsOverride?.executeBuiltinTool ??
            executeBuiltinTool,
        };
        return {
          session: new VoiceSession(
            sessionId,
            ws,
            agentConfig,
            toolSchemas,
            deps,
          ),
          agentConfig,
        };
      },
    });
    return response;
  });

  // Agent page (root)
  app.get("/", (c) => c.html(renderAgentPage(options.agent.config.name)));

  // Static files from clientDir
  if (options.clientDir) {
    const clientDir = options.clientDir;
    app.get("/*", async (c) => {
      const pathname = c.req.path.slice(1); // remove leading /
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
