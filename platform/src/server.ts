// server.ts — WebSocket server setup, session management, HTTP for client library.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";
import { loadPlatformConfig } from "./config.js";
import { MSG, PATHS } from "./constants.js";
import { ERR } from "./errors.js";
import { callLLM } from "./llm.js";
import { Sandbox } from "./sandbox.js";
import { connectStt } from "./stt.js";
import { TtsClient } from "./tts.js";
import {
  AuthenticateMessageSchema,
  ConfigureMessageSchema,
  ControlMessageSchema,
} from "./types.js";
import { VoiceSession, type SessionDeps } from "./session.js";
import { normalizeVoiceText } from "./voice-cleaner.js";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface ServerOptions {
  port: number;
  clientDir?: string;
  secretsFile?: string;
  /** Injectable overrides for session deps (for testing). */
  sessionDepsOverride?: Partial<SessionDeps>;
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

/** Per-customer secrets store, keyed by API key. */
type SecretsStore = Record<string, Record<string, string>>;

export async function loadSecretsFile(path: string): Promise<SecretsStore> {
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    console.log(`[server] Loaded secrets for ${Object.keys(parsed).length} customer(s)`);
    return parsed as SecretsStore;
  } catch (err) {
    console.warn(`[server] Failed to load secrets file: ${err}`);
    return {};
  }
}

/**
 * Create and start the platform server.
 */
export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const sessions = new Map<string, VoiceSession>();

  // Load platform config once (composition root)
  const platformConfig = loadPlatformConfig(process.env);

  // Load per-customer secrets
  const secrets: SecretsStore = options.secretsFile
    ? await loadSecretsFile(options.secretsFile)
    : {};

  // ── HTTP server ────────────────────────────────────────────────

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // Favicon
    if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#2196F3"/><path d="M50 25c-6 0-11 5-11 11v14c0 6 5 11 11 11s11-5 11-11V36c0-6-5-11-11-11z" fill="white"/><path d="M71 50c0 11-9 21-21 21s-21-10-21-21h-6c0 14 10 25 24 27v8h6v-8c14-2 24-13 24-27h-6z" fill="white"/></svg>`;
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(svg);
      return;
    }

    // Health check
    if (url.pathname === PATHS.HEALTH) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Serve static files from clientDir
    if (options.clientDir) {
      // Map / to /index.html, /vanilla/ to /vanilla/index.html, etc.
      let pathname = url.pathname;
      if (pathname.endsWith("/")) pathname += "index.html";

      const ext = extname(pathname);
      if (ext && MIME_TYPES[ext] !== undefined) {
        try {
          const filePath = join(options.clientDir, pathname.slice(1));
          const content = await readFile(filePath);
          res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext],
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
          });
          res.end(content);
          return;
        } catch (err: unknown) {
          // ENOENT is expected (file not found → fall through to 404)
          if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
            console.warn(`[server] Unexpected error reading ${pathname}:`, err);
          }
        }
      }
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // ── WebSocket server ───────────────────────────────────────────

  const wss = new WebSocketServer({
    server: httpServer,
    path: PATHS.WEBSOCKET,
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const sessionId = randomBytes(16).toString("hex");

    let apiKey = "";
    let authenticated = false;
    let session: VoiceSession | null = null;
    let configured = false;
    let ready = false;
    const pendingMessages: { raw: Buffer | ArrayBuffer; isBinary: boolean }[] = [];

    /** Process a single message once the session is ready. */
    async function processMessage(raw: Buffer | ArrayBuffer, isBinary: boolean): Promise<void> {
      if (isBinary) {
        session?.onAudio(raw as Buffer);
        return;
      }

      const parsed = ControlMessageSchema.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) return;

      if (parsed.data.type === MSG.CANCEL) {
        await session?.onCancel();
      } else if (parsed.data.type === MSG.RESET) {
        await session?.onReset();
      }
    }

    ws.on("message", async (raw, isBinary) => {
      // If configured but not yet ready, queue messages for replay after start()
      if (configured && !ready) {
        // Binary audio before STT is connected gets dropped (no STT yet)
        if (!isBinary) {
          pendingMessages.push({ raw: raw as Buffer, isBinary });
        }
        return;
      }

      // Once ready, route binary audio directly
      if (isBinary) {
        if (session) {
          session.onAudio(raw as Buffer);
        }
        return;
      }

      // JSON frame
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        console.warn("[server] Unparseable JSON from client");
        return;
      }

      // Handle ping → pong (always, regardless of state)
      if (data.type === MSG.PING) {
        ws.send(JSON.stringify({ type: MSG.PONG }));
        return;
      }

      // First message must be "authenticate"
      if (!authenticated) {
        const parsed = AuthenticateMessageSchema.safeParse(data);
        if (!parsed.success) {
          ws.send(
            JSON.stringify({
              type: MSG.ERROR,
              message: ERR.MISSING_API_KEY,
            })
          );
          ws.close();
          return;
        }

        apiKey = parsed.data.apiKey;
        authenticated = true;

        // NOTE: We log all connections. Unrecognized keys still work (they just get no secrets).
        if (Object.keys(secrets).length > 0 && !secrets[apiKey]) {
          console.warn(`[server] Unrecognized API key: ${apiKey.slice(0, 8)}...`);
        }

        console.log(
          `[server] Authenticated key=${apiKey.slice(0, 8)}... session=${sessionId.slice(0, 8)}`
        );
        return;
      }

      // Second message must be "configure"
      if (!configured) {
        const parsed = ConfigureMessageSchema.safeParse(data);
        if (!parsed.success) {
          ws.send(
            JSON.stringify({
              type: MSG.ERROR,
              message: ERR.INVALID_CONFIGURE,
            })
          );
          return;
        }

        const cfg = parsed.data;
        const customerSecrets = secrets[apiKey] ?? {};
        const agentConfig = {
          instructions: cfg.instructions ?? "",
          greeting: cfg.greeting ?? "",
          voice: cfg.voice ?? "jess",
          tools: cfg.tools ?? [],
        };

        // Build SessionDeps — the composition root
        const deps: SessionDeps = {
          config: { ...platformConfig, ttsConfig: { ...platformConfig.ttsConfig } },
          connectStt: options.sessionDepsOverride?.connectStt ?? connectStt,
          callLLM: options.sessionDepsOverride?.callLLM ?? callLLM,
          ttsClient:
            options.sessionDepsOverride?.ttsClient ?? new TtsClient(platformConfig.ttsConfig),
          sandbox:
            options.sessionDepsOverride?.sandbox ?? new Sandbox(agentConfig.tools, customerSecrets),
          normalizeVoiceText: options.sessionDepsOverride?.normalizeVoiceText ?? normalizeVoiceText,
        };

        session = new VoiceSession(sessionId, ws, agentConfig, deps);
        sessions.set(sessionId, session);
        configured = true;

        console.log(
          `[server] Session ${sessionId.slice(0, 8)} configured with ${cfg.tools?.length ?? 0} tools`
        );

        await session.start();
        ready = true;

        // Replay any messages that arrived during start()
        for (const msg of pendingMessages) {
          await processMessage(msg.raw, msg.isBinary);
        }
        pendingMessages.length = 0;
        return;
      }

      // Subsequent messages: control commands
      await processMessage(raw as Buffer, false);
    });

    ws.on("close", async () => {
      console.log(`[server] Session ${sessionId.slice(0, 8)} disconnected`);
      if (session) {
        await session.stop();
        sessions.delete(sessionId);
      }
    });

    ws.on("error", (err) => {
      console.error(`[server] WS error session=${sessionId.slice(0, 8)}:`, err.message);
    });
  });

  // ── Start listening ────────────────────────────────────────────

  const actualPort = await new Promise<number>((resolve) => {
    httpServer.listen(options.port, () => {
      const addr = httpServer.address();
      const p = typeof addr === "object" && addr ? addr.port : options.port;
      console.log(`[server] Platform running on port ${p}`);
      console.log(`[server] WebSocket endpoint: ws://localhost:${p}/session`);
      if (options.clientDir) {
        console.log(`[server] Client library: http://localhost:${p}/client.js`);
        console.log(`[server] React hook: http://localhost:${p}/react.js`);
      }
      console.log(`[server] Health check: http://localhost:${p}/health`);
      resolve(p);
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────

  const close = async () => {
    console.log("\n[server] Shutting down...");
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    for (const [id, sess] of sessions) {
      await sess.stop();
      sessions.delete(id);
    }
    wss.close();
    httpServer.close();
  };

  const shutdown = async () => {
    await close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { port: actualPort, close };
}
