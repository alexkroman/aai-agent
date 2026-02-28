import { Hono } from "@hono/hono";
import { getLogger } from "../_utils/logger.ts";
import { applyMiddleware } from "./middleware.ts";
import { favicon } from "./routes/favicon.ts";
import { createHealthRoute } from "./routes/health.ts";
import { createDeployRoute } from "./routes/deploy.ts";
import { createAgentRoutes } from "./routes/agent.ts";
import { type AgentInfo, type AgentSlot, registerSlot } from "./worker_pool.ts";
import type { Session } from "./ws_handler.ts";
import {
  type AgentMetadata,
  listAgents as kvListAgents,
  openKv,
  setAgent as kvSetAgent,
} from "./kv_store.ts";

export type { AgentInfo };

const log = getLogger("orchestrator");

/** Reconcile KV and disk: load known agents, backfill orphaned deploys. */
export async function loadSlots(
  kv: Deno.Kv,
  bundleDir: string,
): Promise<Map<string, AgentSlot>> {
  const slots = new Map<string, AgentSlot>();
  const kvAgents = await kvListAgents(kv);
  const kvSlugs = new Set<string>();

  for (const meta of kvAgents) {
    try {
      await Deno.stat(`${bundleDir}/${meta.slug}/manifest.json`);
    } catch {
      log.warn("KV agent missing from disk, skipping", { slug: meta.slug });
      continue;
    }
    if (registerSlot(slots, meta)) {
      kvSlugs.add(meta.slug);
      log.info("Loaded agent from KV", { slug: meta.slug });
    }
  }

  try {
    for await (const entry of Deno.readDir(bundleDir)) {
      if (!entry.isDirectory) continue;
      const slug = entry.name;
      if (kvSlugs.has(slug)) continue;

      try {
        const text = await Deno.readTextFile(
          `${bundleDir}/${slug}/manifest.json`,
        );
        const manifest: AgentMetadata = JSON.parse(text);
        if (registerSlot(slots, manifest)) {
          await kvSetAgent(kv, manifest);
          log.info("Loaded existing deploy (backfilled to KV)", {
            slug: manifest.slug,
          });
        }
      } catch {
        // skip dirs without valid manifests
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      log.warn("Error scanning bundle directory", { err });
    }
  }

  return slots;
}

export async function createOrchestrator(opts: {
  bundleDir?: string;
  kv?: Deno.Kv;
}): Promise<{ app: Hono; agents: AgentInfo[] }> {
  const bundleDir = opts.bundleDir ?? "bundles";
  await Deno.mkdir(bundleDir, { recursive: true });

  const kv = opts.kv ?? await openKv();
  const slots = await loadSlots(kv, bundleDir);
  const agents: AgentInfo[] = [];
  const sessions = new Map<string, Session>();

  const app = new Hono();
  applyMiddleware(app);
  app.route("/", favicon);
  app.route(
    "/",
    createHealthRoute(() => ({
      agents: [...slots.values()].map((s) => ({
        slug: s.slug,
        name: s.live?.name ?? s.slug,
        ready: !!s.live,
      })),
    })),
  );
  app.route("/", createDeployRoute({ slots, agents, bundleDir, kv }));
  app.route("/", createAgentRoutes({ slots, agents, sessions, bundleDir }));

  return { app, agents };
}
