// server.ts — WebSocket server setup, session management, HTTP for client library.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";
import { ConfigureMessageSchema, ControlMessageSchema } from "./types.js";
import { VoiceSession } from "./session.js";
import { loadSecretsFile, type SecretStore } from "./secrets.js";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
};

interface ServerOptions {
  port: number;
  clientDir?: string; // Directory containing built client.js and react.js
  secretsFile?: string; // Path to JSON secrets file (per-customer)
}

export interface ServerHandle {
  httpServer: ReturnType<typeof createServer>;
  close: () => Promise<void>;
}

/**
 * Create and start the platform server.
 */
export function startServer(options: ServerOptions): ServerHandle {
  const sessions = new Map<string, VoiceSession>();

  // Load per-customer secrets from file
  let secretStore: SecretStore = new Map();
  if (options.secretsFile) {
    secretStore = loadSecretsFile(options.secretsFile);
    console.log(`[server] Loaded secrets for ${secretStore.size} customer(s)`);
  }

  // ── HTTP server ────────────────────────────────────────────────

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // Health check
    if (url.pathname === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Serve client library files
    if (options.clientDir && (url.pathname === "/client.js" || url.pathname === "/react.js")) {
      try {
        const filePath = join(options.clientDir, url.pathname.slice(1));
        const content = await readFile(filePath);
        const ext = extname(url.pathname);
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
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

  const wss = new WebSocketServer({ server: httpServer, path: "/session" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const apiKey = url.searchParams.get("key") ?? "";
    const sessionId = randomBytes(16).toString("hex");

    console.log(
      `[server] Connection from key=${apiKey.slice(0, 8)}... session=${sessionId.slice(0, 8)}`
    );

    // TODO: Validate API key against customer database
    if (!apiKey) {
      ws.send(JSON.stringify({ type: "error", message: "Missing API key" }));
      ws.close();
      return;
    }

    let session: VoiceSession | null = null;
    let configured = false;

    ws.on("message", async (raw, isBinary) => {
      // Binary frame: mic audio → relay to STT
      if (isBinary) {
        if (session) {
          session.onAudio(raw as Buffer);
        }
        return;
      }

      // JSON frame: control or configure message
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // First message must be "configure"
      if (!configured) {
        const parsed = ConfigureMessageSchema.safeParse(data);
        if (!parsed.success) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "First message must be a valid configure message",
            })
          );
          return;
        }

        const cfg = parsed.data;
        const customerSecrets = secretStore.get(apiKey) ?? {};
        session = new VoiceSession(
          sessionId,
          ws,
          {
            instructions: cfg.instructions ?? "",
            greeting: cfg.greeting ?? "",
            voice: cfg.voice ?? "jess",
            tools: cfg.tools ?? [],
          },
          customerSecrets
        );
        sessions.set(sessionId, session);
        configured = true;

        console.log(
          `[server] Session ${sessionId.slice(0, 8)} configured with ${cfg.tools?.length ?? 0} tools`
        );

        await session.start();
        return;
      }

      // Subsequent messages: control commands
      const parsed = ControlMessageSchema.safeParse(data);
      if (!parsed.success) return;

      if (parsed.data.type === "cancel") {
        await session?.onCancel();
      } else if (parsed.data.type === "reset") {
        await session?.onReset();
      }
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

  httpServer.listen(options.port, () => {
    console.log(`[server] Platform running on port ${options.port}`);
    console.log(`[server] WebSocket endpoint: ws://localhost:${options.port}/session`);
    if (options.clientDir) {
      console.log(`[server] Client library: http://localhost:${options.port}/client.js`);
      console.log(`[server] React hook: http://localhost:${options.port}/react.js`);
    }
    console.log(`[server] Health check: http://localhost:${options.port}/health`);
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

  return { httpServer, close };
}
