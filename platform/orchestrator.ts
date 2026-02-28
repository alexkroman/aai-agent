// orchestrator.ts — Dumb-host orchestrator: receives pre-built bundles via
// POST /deploy, writes them to disk, and serves them. Never reads agent source
// code or the agents/ directory. Sessions run in main process; only tool
// execution is sandboxed in Workers via Comlink.

import { toFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";
import * as Comlink from "comlink";
import { Hono } from "@hono/hono";
import { compress } from "@hono/hono/compress";
import { cors } from "@hono/hono/cors";
import { loadPlatformConfig } from "./config.ts";
import type { PlatformConfig } from "./config.ts";
import { createLogger } from "../sdk/logger.ts";
import { FAVICON_SVG, renderAgentPage } from "./server.ts";
import { type SessionDeps, VoiceSession } from "./session.ts";
import { connectStt } from "./stt.ts";
import { callLLM } from "./llm.ts";
import { TtsClient } from "./tts.ts";
import { normalizeVoiceText } from "./voice-cleaner.ts";
import { executeBuiltinTool, getBuiltinToolSchemas } from "./builtin-tools.ts";
import { handleSessionWebSocket } from "./ws-handler.ts";
import { createDenoWorker } from "./deno-ext.ts";
import { withTimeout } from "../sdk/tool-executor.ts";
import type { IToolExecutor } from "../sdk/tool-executor.ts";
import type { AgentConfig, ToolSchema } from "../sdk/types.ts";
import type { WorkerApi } from "./worker-entry.ts";
import {
  type AgentMetadata,
  listAgents as kvListAgents,
  openKv,
  setAgent as kvSetAgent,
} from "./kv-store.ts";

const log = createLogger("orchestrator");

export interface AgentInfo {
  slug: string;
  name: string;
  worker: Worker;
  workerApi: Comlink.Remote<WorkerApi>;
  config: AgentConfig;
  toolSchemas: ToolSchema[];
}

/** How long an agent Worker stays alive with zero sessions before eviction. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Timeout for a single tool call proxied to a worker. */
const TOOL_TIMEOUT_MS = 30_000;

/** Deployed agent slot — tracks worker lifecycle, sessions, and config. */
interface AgentSlot {
  slug: string;
  env: Record<string, string>;
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
 * Proxies tool execution to a Worker via Comlink.
 * Each session gets its own instance.
 */
class ComlinkToolExecutor implements IToolExecutor {
  constructor(private workerApi: Comlink.Remote<WorkerApi>) {}

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      return await withTimeout(
        this.workerApi.executeTool(name, args),
        TOOL_TIMEOUT_MS,
        `Tool "${name}" timed out after 30s`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(`Tool "${name}" timed out after 30s`);
      }
      throw err;
    }
  }

  dispose(): void {
    // Comlink handles cleanup — no manual listener management needed.
  }
}

/** Spawn a Worker from the pre-built bundle and wait for config via Comlink. */
async function spawnAgent(
  slot: AgentSlot,
  bundleDir: string,
): Promise<AgentInfo> {
  const { slug } = slot;
  const workerPath = `${bundleDir}/${slug}/worker.js`;

  log.info({ slug }, "Spawning agent worker");
  const worker = createDenoWorker(toFileUrl(workerPath).href, {
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

  // Crash recovery: clear slot.live so ensureAgent re-spawns on next access
  worker.addEventListener(
    "error",
    ((event: ErrorEvent) => {
      log.error({ slug, error: event.message }, "Worker error");
      if (slot.live?.worker === worker) {
        slot.live = undefined;
      }
    }) as EventListener,
  );

  const workerApi = Comlink.wrap<WorkerApi>(worker);

  let info;
  try {
    info = await withTimeout(
      workerApi.getConfig(),
      15_000,
      `Worker ${slug} ready timed out`,
    );
  } catch (err) {
    worker.terminate();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Worker ${slug} ready timed out`);
    }
    throw err;
  }

  const agentConfig: AgentConfig = {
    instructions: info.config.instructions,
    greeting: info.config.greeting,
    voice: info.config.voice,
    prompt: info.config.prompt,
    builtinTools: info.config.builtinTools,
  };

  const allToolSchemas = [
    ...info.toolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const agentInfo: AgentInfo = {
    slug,
    name: info.config.name ?? slug,
    worker,
    workerApi,
    config: agentConfig,
    toolSchemas: allToolSchemas,
  };
  log.info({ slug, name: agentInfo.name }, "Agent loaded");
  return agentInfo;
}

/**
 * Get or lazily initialize the Worker for a slot.
 * Deduplicates concurrent calls so spawning only happens once.
 */
function ensureAgent(slot: AgentSlot, bundleDir: string): Promise<AgentInfo> {
  if (slot.live) return Promise.resolve(slot.live);
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, bundleDir).then((info) => {
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

/** Register a slot from manifest metadata (disk or KV). */
function registerSlot(
  slots: Map<string, AgentSlot>,
  metadata: AgentMetadata,
): boolean {
  let platformConfig;
  try {
    platformConfig = loadPlatformConfig(metadata.env);
  } catch (err) {
    log.warn(
      { slug: metadata.slug, err },
      "Skipping deploy — missing platform config",
    );
    return false;
  }

  slots.set(metadata.slug, {
    slug: metadata.slug,
    env: metadata.env,
    platformConfig,
    activeSessions: 0,
  });
  return true;
}

export async function createOrchestrator(opts: {
  bundleDir?: string;
}): Promise<{ app: Hono; agents: AgentInfo[] }> {
  const bundleDir = opts.bundleDir ?? "bundles";
  await Deno.mkdir(bundleDir, { recursive: true });

  const slots = new Map<string, AgentSlot>();
  const agents: AgentInfo[] = [];
  const sessions = new Map<string, VoiceSession>();

  // ── Open KV and load persisted agents ──────────────────────────
  const kv = await openKv();
  const kvAgents = await kvListAgents(kv);
  const kvSlugs = new Set<string>();

  for (const meta of kvAgents) {
    // Verify the bundle still exists on disk
    try {
      await Deno.stat(`${bundleDir}/${meta.slug}/manifest.json`);
    } catch {
      log.warn({ slug: meta.slug }, "KV agent missing from disk, skipping");
      continue;
    }
    if (registerSlot(slots, meta)) {
      kvSlugs.add(meta.slug);
      log.info({ slug: meta.slug }, "Loaded agent from KV");
    }
  }

  // ── Walk bundleDir for agents not yet in KV (backfill) ─────────
  try {
    for await (
      const entry of walk(bundleDir, {
        maxDepth: 2,
        includeDirs: false,
        match: [/manifest\.json$/],
      })
    ) {
      const slug = entry.path.replace(/\/manifest\.json$/, "").split("/")
        .pop()!;
      if (kvSlugs.has(slug)) continue; // already loaded from KV

      try {
        const text = await Deno.readTextFile(entry.path);
        const manifest: AgentMetadata = JSON.parse(text);
        if (registerSlot(slots, manifest)) {
          // Backfill into KV for next startup
          await kvSetAgent(kv, manifest);
          log.info(
            { slug: manifest.slug },
            "Loaded existing deploy (backfilled to KV)",
          );
        }
      } catch {
        // skip malformed manifests
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      log.warn({ err }, "Error scanning bundle directory");
    }
  }

  // ── Build Hono app ─────────────────────────────────────────────
  const app = new Hono();
  app.use("*", cors());
  app.use("*", compress());

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

  // ── POST /deploy — receive and register a bundle ───────────────
  app.post("/deploy", async (c) => {
    let body: {
      slug: string;
      env: Record<string, string>;
      worker: string;
      client: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.slug || !body.env || !body.worker || !body.client) {
      return c.json(
        { error: "Missing required fields: slug, env, worker, client" },
        400,
      );
    }

    let platformConfig;
    try {
      platformConfig = loadPlatformConfig(body.env);
    } catch (err) {
      return c.json(
        { error: `Invalid platform config: ${(err as Error).message}` },
        400,
      );
    }

    // If slug already deployed, terminate old worker
    const existing = slots.get(body.slug);
    if (existing?.live) {
      log.info({ slug: body.slug }, "Replacing existing deploy");
      existing.live.worker.terminate();
      const idx = agents.indexOf(existing.live);
      if (idx !== -1) agents.splice(idx, 1);
      existing.live = undefined;
      existing.initializing = undefined;
    }

    // Write bundle files to disk
    const slugDir = `${bundleDir}/${body.slug}`;
    await Deno.mkdir(slugDir, { recursive: true });
    await Promise.all([
      Deno.writeTextFile(`${slugDir}/worker.js`, body.worker),
      Deno.writeTextFile(`${slugDir}/client.js`, body.client),
      Deno.writeTextFile(
        `${slugDir}/manifest.json`,
        JSON.stringify({ slug: body.slug, env: body.env }, null, 2) + "\n",
      ),
    ]);

    // Persist to KV
    await kvSetAgent(kv, { slug: body.slug, env: body.env });

    // Register in slots map
    slots.set(body.slug, {
      slug: body.slug,
      env: body.env,
      platformConfig,
      activeSessions: 0,
    });

    log.info({ slug: body.slug }, "Deploy received");
    return c.json({ ok: true, message: `Deployed ${body.slug}` });
  });

  // ── Parameterized agent routes: /:slug/* ───────────────────────

  // Agent page — triggers lazy worker spawn on first access
  app.get("/:slug/", async (c) => {
    const slug = c.req.param("slug");
    const slot = slots.get(slug);
    if (!slot) return c.text("Not found", 404);

    try {
      const info = await ensureAgent(slot, bundleDir);
      if (!agents.includes(info)) agents.push(info);
      return c.html(renderAgentPage(info.name, `/${slug}`));
    } catch (err) {
      log.error({ slug, err }, "Failed to initialize agent");
      return c.text("Agent failed to initialize", 500);
    }
  });

  // Redirect without trailing slash
  app.get("/:slug", (c) => {
    const slug = c.req.param("slug");
    if (!slots.has(slug)) return c.text("Not found", 404);
    return c.redirect(`/${slug}/`, 301);
  });

  // WebSocket — session runs in main process
  app.get("/:slug/session", async (c) => {
    const slug = c.req.param("slug");
    const slot = slots.get(slug);
    if (!slot) return c.text("Not found", 404);

    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected WebSocket upgrade", 400);
    }

    let info: AgentInfo;
    try {
      info = await ensureAgent(slot, bundleDir);
      if (!agents.includes(info)) agents.push(info);
    } catch (err) {
      log.error({ slug, err }, "Failed to initialize agent for session");
      return c.text("Agent failed to initialize", 500);
    }

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    handleSessionWebSocket(socket, sessions, {
      createSession: (sessionId, ws) => {
        const toolExecutor = new ComlinkToolExecutor(info.workerApi);
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

  // Serve client.js from bundle directory
  app.get("/:slug/client.js", async (c) => {
    const slug = c.req.param("slug");
    if (!slots.has(slug)) return c.text("Not found", 404);

    try {
      const content = await Deno.readFile(`${bundleDir}/${slug}/client.js`);
      return c.body(content, {
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // Serve client.js.map (sourcemap) from bundle directory
  app.get("/:slug/client.js.map", async (c) => {
    const slug = c.req.param("slug");
    if (!slots.has(slug)) return c.text("Not found", 404);

    try {
      const content = await Deno.readFile(
        `${bundleDir}/${slug}/client.js.map`,
      );
      return c.body(content, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // Favicon per-agent path
  app.get("/:slug/favicon.svg", (c) =>
    c.body(FAVICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    }));

  return { app, agents };
}
