// orchestrator.ts — Multi-agent orchestrator: discovers agents, lazily bundles
// and spawns Workers on first access. Sessions run in main process; only tool
// execution is sandboxed in Workers via postMessage.

import { toFileUrl } from "@std/path";
import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { loadPlatformConfig } from "../sdk/config.ts";
import type { PlatformConfig } from "../sdk/config.ts";
import { createLogger } from "../sdk/logger.ts";
import { configureLogger } from "../sdk/logger.ts";
import { FAVICON_SVG, renderAgentPage } from "../sdk/server.ts";
import { bundleAgent } from "./bundler.ts";
import { type SessionDeps, VoiceSession } from "../sdk/session.ts";
import { connectStt } from "../sdk/stt.ts";
import { callLLM } from "../sdk/llm.ts";
import { TtsClient } from "../sdk/tts.ts";
import { normalizeVoiceText } from "../sdk/voice-cleaner.ts";
import { getBuiltinToolSchemas } from "../sdk/builtin-tools.ts";
import { MSG } from "../sdk/shared-protocol.ts";
import type { AgentOptions } from "../sdk/agent.ts";
import {
  type AgentConfig,
  ControlMessageSchema,
  type ToolSchema,
} from "../sdk/types.ts";

const log = createLogger("orchestrator");

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

export interface AgentInfo {
  slug: string;
  name: string;
  worker: Worker;
  config: AgentConfig;
  toolSchemas: ToolSchema[];
}

/** How long an agent Worker stays alive with zero sessions before eviction. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Timeout for a single tool call proxied to a worker. */
const TOOL_TIMEOUT_MS = 30_000;

/** Discovered agent before it's been bundled/spawned. */
interface AgentSlot {
  slug: string;
  mergedEnv: Record<string, string>;
  platformConfig: PlatformConfig;
  /** Set once the agent's Worker is live. */
  live?: AgentInfo;
  /** In-flight init promise (deduplicates concurrent first-access). */
  initializing?: Promise<AgentInfo>;
  /** Number of active WebSocket sessions routed to this Worker. */
  activeSessions: number;
  /** Timer that fires when the Worker has been idle too long. */
  idleTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Proxies tool execution to a Worker via postMessage.
 * Each session gets its own instance. Uses callId to route responses.
 */
class WorkerToolExecutor {
  private pending = new Map<
    string,
    {
      resolve: (v: string) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private handler: (event: MessageEvent) => void;

  constructor(private worker: Worker) {
    this.handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "tool.result") {
        const entry = this.pending.get(msg.callId);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.callId);
          entry.resolve(msg.result);
        }
      }
    };
    worker.addEventListener("message", this.handler);
  }

  execute(name: string, args: Record<string, unknown>): Promise<string> {
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`Tool "${name}" timed out after 30s`));
      }, TOOL_TIMEOUT_MS);
      this.pending.set(callId, { resolve, reject, timer });
      this.worker.postMessage({ type: "tool.call", callId, name, args });
    });
  }

  dispose(): void {
    this.worker.removeEventListener("message", this.handler);
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("ToolExecutor disposed"));
    }
    this.pending.clear();
  }
}

/** Read a .env file and return key-value pairs. */
async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    const text = await Deno.readTextFile(path);
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

/** Bundle an agent, spawn its Worker, wait for ready. */
async function spawnAgent(slot: AgentSlot): Promise<AgentInfo> {
  const { slug, mergedEnv, platformConfig: _pc } = slot;

  log.info({ slug }, "Bundling agent on first access");
  const bundlePath = await bundleAgent(slug);

  const worker = new Worker(toFileUrl(bundlePath).href, {
    type: "module",
    name: slug,
    // @ts-ignore: Deno Worker permissions
    deno: {
      permissions: {
        net: true,
        read: false,
        env: false,
        run: false,
        write: false,
        ffi: false,
      },
    },
  });

  worker.onerror = (event) => {
    log.error({ slug, error: event.message }, "Worker error");
  };

  const readyPromise = new Promise<{
    slug: string;
    config: AgentOptions;
    toolSchemas: ToolSchema[];
  }>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Worker ${slug} init timed out`)),
      15_000,
    );
    const handler = (event: MessageEvent) => {
      if (event.data.type === "ready") {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve(event.data);
      }
    };
    worker.addEventListener("message", handler);
  });

  worker.postMessage({
    type: "init",
    slug,
    secrets: mergedEnv,
  });

  const info = await readyPromise;

  // Build AgentConfig (without name) for VoiceSession
  const agentConfig: AgentConfig = {
    instructions: info.config.instructions,
    greeting: info.config.greeting,
    voice: info.config.voice,
    prompt: info.config.prompt,
    builtinTools: info.config.builtinTools,
  };

  // Merge worker's agent tool schemas with builtin tool schemas
  const allToolSchemas = [
    ...info.toolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const agentInfo: AgentInfo = {
    slug,
    name: info.config.name ?? slug,
    worker,
    config: agentConfig,
    toolSchemas: allToolSchemas,
  };
  log.info({ slug, name: agentInfo.name }, "Agent loaded");
  return agentInfo;
}

/**
 * Get or lazily initialize the Worker for a slot.
 * Deduplicates concurrent calls so bundling only happens once.
 */
function ensureAgent(slot: AgentSlot): Promise<AgentInfo> {
  if (slot.live) return Promise.resolve(slot.live);
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot).then((info) => {
    slot.live = info;
    slot.initializing = undefined;
    return info;
  }).catch((err) => {
    slot.initializing = undefined;
    throw err;
  });

  return slot.initializing;
}

/** Track a new session opening — cancels any pending idle timer. */
function trackSessionOpen(slot: AgentSlot): void {
  slot.activeSessions++;
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = undefined;
  }
}

/** Track a session closing — starts the idle eviction timer if zero sessions remain. */
function trackSessionClose(slot: AgentSlot, agents: AgentInfo[]): void {
  slot.activeSessions = Math.max(0, slot.activeSessions - 1);
  if (slot.activeSessions === 0 && slot.live) {
    slot.idleTimer = setTimeout(() => {
      if (slot.activeSessions === 0 && slot.live) {
        log.info({ slug: slot.slug }, "Evicting idle agent Worker");
        slot.live.worker.terminate();
        const idx = agents.indexOf(slot.live);
        if (idx !== -1) agents.splice(idx, 1);
        slot.live = undefined;
        slot.idleTimer = undefined;
      }
    }, IDLE_TIMEOUT_MS);
  }
}

/** Handle a WebSocket connection: create VoiceSession in main process. */
function handleAgentWebSocket(
  ws: WebSocket,
  info: AgentInfo,
  slot: AgentSlot,
  agents: AgentInfo[],
  sessions: Map<string, VoiceSession>,
): void {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);

  let session: VoiceSession | null = null;
  let ready = false;
  const pendingMessages: { data: string | ArrayBuffer; isBinary: boolean }[] =
    [];

  function processMessage(
    data: string | ArrayBuffer,
    isBinary: boolean,
  ): void {
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
      session?.onCancel();
    } else if (parsed.data.type === MSG.RESET) {
      session?.onReset();
    }
  }

  ws.onopen = async () => {
    trackSessionOpen(slot);
    log.info({ slug: info.slug, sid }, "Session opened");

    const toolExecutor = new WorkerToolExecutor(info.worker);

    const deps: SessionDeps = {
      config: {
        ...slot.platformConfig,
        ttsConfig: { ...slot.platformConfig.ttsConfig },
      },
      connectStt,
      callLLM,
      ttsClient: new TtsClient(slot.platformConfig.ttsConfig),
      toolExecutor,
      normalizeVoiceText,
    };

    session = new VoiceSession(
      sessionId,
      ws,
      info.config,
      info.toolSchemas,
      deps,
    );
    sessions.set(sessionId, session);

    log.info(
      { slug: info.slug, sid, tools: info.toolSchemas.length },
      "Session configured",
    );

    await session.start();
    ready = true;

    for (const msg of pendingMessages) {
      processMessage(msg.data, msg.isBinary);
    }
    pendingMessages.length = 0;
  };

  ws.onmessage = async (event) => {
    const isBinary = event.data instanceof ArrayBuffer ||
      event.data instanceof Blob;

    if (!ready) {
      if (!isBinary) {
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

    if (isBinary) {
      if (event.data instanceof ArrayBuffer) {
        session?.onAudio(new Uint8Array(event.data));
      } else if (event.data instanceof Blob) {
        const buf = await event.data.arrayBuffer();
        session?.onAudio(new Uint8Array(buf));
      }
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      log.warn({ sid }, "Unparseable JSON from client");
      return;
    }

    if (data.type === MSG.PING) {
      ws.send(JSON.stringify({ type: MSG.PONG }));
      return;
    }

    processMessage(event.data as string, false);
  };

  ws.onclose = async () => {
    log.info({ slug: info.slug, sid }, "Session closed");
    if (session) {
      await session.stop();
      sessions.delete(sessionId);
    }
    trackSessionClose(slot, agents);
  };

  ws.onerror = (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error({ slug: info.slug, sid, error: msg }, "WS error");
  };
}

export async function createOrchestrator(opts: {
  clientDir?: string;
}): Promise<{ app: Hono; agents: AgentInfo[] }> {
  // Forward runtime env vars that workers need but can't read themselves
  const runtimeEnv: Record<string, string> = {};
  for (const key of ["LOG_LEVEL", "DENO_ENV"]) {
    const val = Deno.env.get(key);
    if (val) runtimeEnv[key] = val;
  }
  const rootEnv = { ...runtimeEnv, ...await readEnvFile(".env") };

  // Configure logger for orchestrator
  configureLogger({
    logLevel: rootEnv.LOG_LEVEL,
    denoEnv: rootEnv.DENO_ENV,
  });

  // Scan agents/ directory — lightweight, no bundling yet
  const slots = new Map<string, AgentSlot>();
  const agentDirs: string[] = [];
  for await (const entry of Deno.readDir("agents")) {
    if (entry.isDirectory) {
      try {
        await Deno.stat(`agents/${entry.name}/agent.ts`);
        agentDirs.push(entry.name);
      } catch {
        // No agent.ts in this directory, skip
      }
    }
  }
  agentDirs.sort();

  for (const slug of agentDirs) {
    const agentEnv = await readEnvFile(`agents/${slug}/.env`);
    const mergedEnv = { ...rootEnv, ...agentEnv };

    let platformConfig;
    try {
      platformConfig = loadPlatformConfig(mergedEnv);
    } catch (err) {
      log.warn({ slug, err }, "Skipping agent — missing platform config");
      continue;
    }

    slots.set(slug, { slug, mergedEnv, platformConfig, activeSessions: 0 });
  }

  // The `agents` array is populated lazily; returned for health-check etc.
  const agents: AgentInfo[] = [];
  const sessions = new Map<string, VoiceSession>();

  // Build Hono app
  const app = new Hono();
  app.use("*", cors());

  // Health check
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      agents: [...slots.values()].map((s) => ({
        slug: s.slug,
        name: s.live?.name ?? s.slug,
        ready: !!s.live,
      })),
    }));

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

  // Landing page — shows all discovered agents (even if not yet spawned)
  app.get("/", (c) => {
    const cards = [...slots.values()]
      .map(
        (s) =>
          `<a href="/${s.slug}/" style="display:block;padding:1rem;margin:0.5rem 0;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:inherit;">
        <strong>${s.live?.name ?? s.slug}</strong>
        <span style="color:#888;margin-left:0.5rem">/${s.slug}/</span>
      </a>`,
      )
      .join("\n");

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Agents</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    a:hover { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Voice Agents</h1>
  ${cards}
</body>
</html>`);
  });

  // Per-agent routes — registered for all discovered slugs
  for (const slot of slots.values()) {
    const { slug } = slot;

    // Agent page (triggers lazy bundle + spawn)
    app.get(`/${slug}/`, async (c) => {
      try {
        const info = await ensureAgent(slot);
        if (!agents.includes(info)) agents.push(info);
        return c.html(renderAgentPage(info.name, `/${slug}`));
      } catch (err) {
        log.error({ slug, err }, "Failed to initialize agent");
        return c.text("Agent failed to initialize", 500);
      }
    });

    // Redirect without trailing slash
    app.get(`/${slug}`, (c) => c.redirect(`/${slug}/`, 301));

    // WebSocket — session runs in main process
    app.get(`/${slug}/session`, async (c) => {
      if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return c.text("Expected WebSocket upgrade", 400);
      }

      let info: AgentInfo;
      try {
        info = await ensureAgent(slot);
        if (!agents.includes(info)) agents.push(info);
      } catch (err) {
        log.error({ slug, err }, "Failed to initialize agent for session");
        return c.text("Agent failed to initialize", 500);
      }

      const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
      handleAgentWebSocket(socket, info, slot, agents, sessions);
      return response;
    });

    // Static files for this agent's path
    if (opts.clientDir) {
      const clientDir = opts.clientDir;
      app.get(`/${slug}/*`, async (c) => {
        // Strip /:slug/ prefix to get the file path
        const pathname = c.req.path.slice(slug.length + 2);
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
  }

  return { app, agents };
}
