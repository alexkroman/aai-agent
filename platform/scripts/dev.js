// dev.js — Dev orchestrator: serves examples on :3000, API on :3001.
// Client bundles are rebuilt automatically via esbuild watch.

import { context } from "esbuild";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { WebSocketServer, WebSocket } from "ws";

const EXAMPLES_PORT = 3000;
const API_PORT = 3001;
const ROOT = new URL("..", import.meta.url).pathname;
const EXAMPLES_DIR = join(ROOT, "..", "examples");
const BUNDLE_DIR = join(ROOT, "dist", "client");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ── 1. esbuild watch for client bundles ────────────────────────

mkdirSync(BUNDLE_DIR, { recursive: true });

const ctx = await context({
  entryPoints: ["client/client.ts", "client/react.ts"],
  bundle: true,
  format: "esm",
  outdir: BUNDLE_DIR,
  sourcemap: true,
  target: "es2022",
  loader: { ".worklet.js": "text" },
});

await ctx.watch();
console.log("  esbuild watching client bundles");

// ── 2. Examples static server ──────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname.endsWith("/")) pathname += "index.html";

  const ext = extname(pathname);
  const mime = MIME_TYPES[ext];
  if (!mime) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Try dist/ first (client.js, react.js, source maps)
  try {
    const content = await readFile(join(BUNDLE_DIR, pathname.slice(1)));
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(content);
    return;
  } catch {}

  // Then examples/
  try {
    const content = await readFile(join(EXAMPLES_DIR, pathname.slice(1)));
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(content);
    return;
  } catch {}

  res.writeHead(404);
  res.end("Not found");
});

server.listen(EXAMPLES_PORT, () => {
  console.log(`  Examples:  http://localhost:${EXAMPLES_PORT}`);
  console.log(`  API:       http://localhost:${API_PORT}`);
});

// ── 3. WebSocket proxy: :3000/session → :3001/session ──────────

const wss = new WebSocketServer({ server, path: "/session" });

wss.on("connection", (clientWs) => {
  const apiWs = new WebSocket(`ws://localhost:${API_PORT}/session`);
  const pending = [];

  clientWs.on("message", (data, isBinary) => {
    if (apiWs.readyState === WebSocket.OPEN) {
      apiWs.send(data, { binary: isBinary });
    } else {
      pending.push({ data, isBinary });
    }
  });

  apiWs.on("open", () => {
    for (const msg of pending) apiWs.send(msg.data, { binary: msg.isBinary });
    pending.length = 0;
  });

  apiWs.on("message", (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
  });

  clientWs.on("close", () => apiWs.close());
  apiWs.on("close", () => clientWs.close());
  apiWs.on("error", () => clientWs.close());
  clientWs.on("error", () => apiWs.close());
});

// ── 4. API server (tsx watch for hot reload) ───────────────────

const api = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(API_PORT) },
  stdio: "inherit",
});

api.on("error", (err) => {
  console.error("Failed to start API server:", err.message);
  process.exit(1);
});

// ── 5. Graceful shutdown ───────────────────────────────────────

function cleanup() {
  api.kill();
  ctx.dispose();
  server.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
