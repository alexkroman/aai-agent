// server.ts — Hono-based HTTP/WS handler factory, called by Agent.serve().
// Deno-native: uses Deno.serve(), Deno.upgradeWebSocket(), standard WebSocket API.

import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import type { PlatformConfig } from "./config.ts";
import { MSG } from "./shared-protocol.ts";
import { callLLM } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { agentToolsToSchemas } from "./protocol.ts";
import { ToolExecutor } from "./tool-executor.ts";
import { connectStt } from "./stt.ts";
import { TtsClient } from "./tts.ts";
import { type AgentConfig, ControlMessageSchema } from "./types.ts";
import { getBuiltinToolSchemas } from "./builtin-tools.ts";
import { type SessionDeps, VoiceSession } from "./session.ts";
import { normalizeVoiceText } from "./voice-cleaner.ts";
import type { Agent } from "./agent.ts";

const log = createLogger("server");

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    const { VoiceAgent } = await import("${basePath}/client.js");
    VoiceAgent.start({ element: "#app", platformUrl: window.location.origin + "${basePath}" });
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

  // CORS middleware
  app.use("*", cors());

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
    handleWebSocket(socket, options, sessions);
    return response;
  });

  // Agent page (root)
  app.get("/", (c) => c.html(renderAgentPage(options.agent.config.name)));

  // Static files from clientDir
  if (options.clientDir) {
    const clientDir = options.clientDir;
    app.get("/*", async (c) => {
      const pathname = c.req.path.slice(1); // remove leading /
      const ext = "." + pathname.split(".").pop();
      const mime = MIME_TYPES[ext];
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

/** Handle a WebSocket connection for a voice session. */
function handleWebSocket(
  ws: WebSocket,
  options: ServerHandlerOptions,
  sessions: Map<string, VoiceSession>,
): void {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);

  let session: VoiceSession | null = null;
  let ready = false;
  const pendingMessages: { data: string | ArrayBuffer; isBinary: boolean }[] =
    [];

  /** Process a single message once the session is ready. */
  async function processMessage(
    data: string | ArrayBuffer,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      if (data instanceof ArrayBuffer) {
        session?.onAudio(new Uint8Array(data));
      }
      return;
    }

    let json;
    try {
      json = JSON.parse(data as string);
    } catch {
      return;
    }
    const parsed = ControlMessageSchema.safeParse(json);
    if (!parsed.success) return;

    if (parsed.data.type === MSG.AUDIO_READY) {
      session?.onAudioReady();
    } else if (parsed.data.type === MSG.CANCEL) {
      await session?.onCancel();
    } else if (parsed.data.type === MSG.RESET) {
      await session?.onReset();
    }
  }

  // No authenticate/configure needed — agent is already configured server-side.
  // Start session immediately on connection.
  ws.onopen = async () => {
    log.info({ sid }, "Session connected");

    // Build agent config + tool schemas
    const agentConfig: AgentConfig = {
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

    // Build SessionDeps
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
        new ToolExecutor(options.agent.getToolHandlers(), options.secrets),
      normalizeVoiceText: options.sessionDepsOverride?.normalizeVoiceText ??
        normalizeVoiceText,
    };

    session = new VoiceSession(sessionId, ws, agentConfig, toolSchemas, deps);
    sessions.set(sessionId, session);

    log.info(
      { sid, tools: toolSchemas.length },
      "Session configured",
    );

    await session.start();
    ready = true;

    // Replay any messages that arrived during start()
    for (const msg of pendingMessages) {
      await processMessage(msg.data, msg.isBinary);
    }
    pendingMessages.length = 0;
  };

  ws.onmessage = async (event) => {
    const isBinary = event.data instanceof ArrayBuffer ||
      event.data instanceof Blob;

    // Queue messages until session is ready
    if (!ready) {
      if (!isBinary) {
        // Check for ping even before ready
        try {
          const json = JSON.parse(event.data as string);
          if (json.type === MSG.PING) {
            ws.send(JSON.stringify({ type: MSG.PONG }));
            return;
          }
        } catch {
          // ignore parse errors
        }
        pendingMessages.push({ data: event.data as string, isBinary: false });
      }
      return;
    }

    // Binary audio
    if (isBinary) {
      if (event.data instanceof ArrayBuffer) {
        session?.onAudio(new Uint8Array(event.data));
      } else if (event.data instanceof Blob) {
        const buf = await event.data.arrayBuffer();
        session?.onAudio(new Uint8Array(buf));
      }
      return;
    }

    // JSON frame
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      log.warn({ sid }, "Unparseable JSON from client");
      return;
    }

    // Handle ping → pong
    if (data.type === MSG.PING) {
      ws.send(JSON.stringify({ type: MSG.PONG }));
      return;
    }

    // Control commands
    await processMessage(event.data as string, false);
  };

  ws.onclose = async () => {
    log.info({ sid }, "Session disconnected");
    if (session) {
      await session.stop();
      sessions.delete(sessionId);
    }
  };

  ws.onerror = (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error({ sid, error: msg }, "WebSocket error");
  };
}
