import { walk } from "@std/fs/walk";
import { Hono } from "@hono/hono";
import { createLogger } from "../sdk/logger.ts";
import { applyMiddleware } from "./middleware.ts";
import { favicon } from "./routes/favicon.ts";
import { createHealthRoute } from "./routes/health.ts";
import { createDeployRoute } from "./routes/deploy.ts";
import { createAgentRoutes } from "./routes/agent.ts";
import { type AgentInfo, type AgentSlot, registerSlot } from "./worker-pool.ts";
import { ServerSession } from "./session.ts";
import {
  type AgentMetadata,
  listAgents as kvListAgents,
  openKv,
  setAgent as kvSetAgent,
} from "./kv-store.ts";

export type { AgentInfo };

const log = createLogger("orchestrator");

export async function createOrchestrator(opts: {
  bundleDir?: string;
}): Promise<{ app: Hono; agents: AgentInfo[] }> {
  const bundleDir = opts.bundleDir ?? "bundles";
  await Deno.mkdir(bundleDir, { recursive: true });

  const slots = new Map<string, AgentSlot>();
  const agents: AgentInfo[] = [];
  const sessions = new Map<string, ServerSession>();

  // ── Load agents from KV + disk ──────────────────────────────────
  const kv = await openKv();
  const kvAgents = await kvListAgents(kv);
  const kvSlugs = new Set<string>();

  for (const meta of kvAgents) {
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
      if (kvSlugs.has(slug)) continue;

      try {
        const text = await Deno.readTextFile(entry.path);
        const manifest: AgentMetadata = JSON.parse(text);
        if (registerSlot(slots, manifest)) {
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

  // ── Compose Hono app ────────────────────────────────────────────
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
