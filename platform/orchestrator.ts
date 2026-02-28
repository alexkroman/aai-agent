// orchestrator.ts — Multi-agent orchestrator: discovers agents, lazily bundles
// and spawns Workers on first access. Sessions run in main process; only tool
// execution is sandboxed in Workers via postMessage.

import { toFileUrl } from "@std/path";
import { deadline } from "@std/async/deadline";
import { parse as parseDotenv } from "@std/dotenv/parse";
import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { loadPlatformConfig } from "../sdk/config.ts";
import type { PlatformConfig } from "../sdk/config.ts";
import { createLogger } from "../sdk/logger.ts";
import { configureLogger } from "../sdk/logger.ts";
import { escapeHtml, FAVICON_SVG, renderAgentPage } from "../sdk/server.ts";
import { bundleAgent } from "./bundler.ts";
import { type SessionDeps, VoiceSession } from "../sdk/session.ts";
import { connectStt } from "../sdk/stt.ts";
import { callLLM } from "../sdk/llm.ts";
import { TtsClient } from "../sdk/tts.ts";
import { normalizeVoiceText } from "../sdk/voice-cleaner.ts";
import {
  executeBuiltinTool,
  getBuiltinToolSchemas,
} from "../sdk/builtin-tools.ts";
import { handleSessionWebSocket } from "../sdk/ws-handler.ts";
import { typeByExtension } from "@std/media-types";
import { createDenoWorker } from "../sdk/deno-ext.ts";
import {
  type AgentConfig,
  type ToolSchema,
  type WorkerInMessage,
  type WorkerOutMessage,
} from "../sdk/types.ts";

const log = createLogger("orchestrator");

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
    { resolve: (v: string) => void; reject: (e: Error) => void }
  >();
  private handler: (event: MessageEvent<WorkerOutMessage>) => void;
  private errorHandler: (event: ErrorEvent) => void;

  constructor(private worker: Worker) {
    this.handler = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === "tool.result") {
        const entry = this.pending.get(msg.callId);
        if (entry) {
          this.pending.delete(msg.callId);
          entry.resolve(msg.result);
        }
      }
    };
    worker.addEventListener("message", this.handler);

    // If the worker crashes, reject all pending tool calls immediately
    // instead of waiting for each one to hit the 30s timeout.
    this.errorHandler = (event: ErrorEvent) => {
      const err = new Error(`Worker crashed: ${event.message}`);
      for (const [, entry] of this.pending) {
        entry.reject(err);
      }
      this.pending.clear();
    };
    worker.addEventListener("error", this.errorHandler as EventListener);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const callId = crypto.randomUUID();
    const resultPromise = new Promise<string>((resolve, reject) => {
      this.pending.set(callId, { resolve, reject });
      const msg: WorkerInMessage = { type: "tool.call", callId, name, args };
      this.worker.postMessage(msg);
    });
    try {
      return await deadline(resultPromise, TOOL_TIMEOUT_MS);
    } catch (err) {
      this.pending.delete(callId);
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(`Tool "${name}" timed out after 30s`);
      }
      throw err;
    }
  }

  dispose(): void {
    this.worker.removeEventListener("message", this.handler);
    this.worker.removeEventListener(
      "error",
      this.errorHandler as EventListener,
    );
    for (const [, entry] of this.pending) {
      entry.reject(new Error("ToolExecutor disposed"));
    }
    this.pending.clear();
  }
}

/** Read a .env file and return key-value pairs. */
async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    const text = await Deno.readTextFile(path);
    return parseDotenv(text);
  } catch {
    return {};
  }
}

/** Bundle an agent, spawn its Worker, wait for ready. */
async function spawnAgent(slot: AgentSlot): Promise<AgentInfo> {
  const { slug, mergedEnv, platformConfig: _pc } = slot;

  log.info({ slug }, "Bundling agent on first access");
  const bundlePath = await bundleAgent(slug);

  const worker = createDenoWorker(toFileUrl(bundlePath).href, {
    type: "module",
    name: slug,
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

  let readyHandler: ((event: MessageEvent<WorkerOutMessage>) => void) | null =
    null;
  const readyPromise = new Promise<
    Extract<WorkerOutMessage, { type: "ready" }>
  >((resolve) => {
    readyHandler = (event: MessageEvent<WorkerOutMessage>) => {
      if (event.data.type === "ready") {
        worker.removeEventListener("message", readyHandler!);
        readyHandler = null;
        resolve(event.data);
      }
    };
    worker.addEventListener("message", readyHandler);
  });

  const initMsg: WorkerInMessage = {
    type: "init",
    slug,
    secrets: mergedEnv,
  };
  worker.postMessage(initMsg);

  let info;
  try {
    info = await deadline(readyPromise, 15_000);
  } catch (err) {
    // Clean up: remove the ready handler and terminate the orphaned worker
    if (readyHandler) {
      worker.removeEventListener("message", readyHandler);
    }
    worker.terminate();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Worker ${slug} init timed out`);
    }
    throw err;
  }

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
 *
 * Safe from double-spawn: the synchronous check + assignment of
 * `slot.initializing` happens before any `await`, so in single-threaded
 * JS no other caller can slip past the guard.
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
          `<a href="/${
            encodeURIComponent(s.slug)
          }/" style="display:block;padding:1rem;margin:0.5rem 0;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:inherit;">
        <strong>${escapeHtml(s.live?.name ?? s.slug)}</strong>
        <span style="color:#888;margin-left:0.5rem">/${
            escapeHtml(s.slug)
          }/</span>
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
      handleSessionWebSocket(socket, sessions, {
        createSession: (sessionId, ws) => {
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
            executeBuiltinTool,
          };
          return {
            session: new VoiceSession(
              sessionId,
              ws,
              info.config,
              info.toolSchemas,
              deps,
            ),
            agentConfig: info.config,
          };
        },
        logContext: { slug: info.slug },
        onOpen: () => trackSessionOpen(slot),
        onClose: () => trackSessionClose(slot, agents),
      });
      return response;
    });

    // Static files for this agent's path
    if (opts.clientDir) {
      const clientDir = opts.clientDir;
      app.get(`/${slug}/*`, async (c) => {
        // Strip /:slug/ prefix to get the file path
        const pathname = c.req.path.slice(slug.length + 2);
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
  }

  return { app, agents };
}
