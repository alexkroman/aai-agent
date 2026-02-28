import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { loadPlatformConfig } from "../config.ts";
import { getLogger } from "../../_utils/logger.ts";
import type { AgentInfo, AgentSlot } from "../worker_pool.ts";
import { setAgent as kvSetAgent } from "../kv_store.ts";

const log = getLogger("deploy");

export function createDeployRoute(ctx: {
  slots: Map<string, AgentSlot>;
  agents: AgentInfo[];
  bundleDir: string;
  kv: Deno.Kv;
}): Hono {
  const { slots, agents, bundleDir, kv } = ctx;
  const deploy = new Hono();

  deploy.post("/deploy", async (c) => {
    let body: {
      slug: string;
      env: Record<string, string>;
      worker: string;
      client: string;
    };
    try {
      body = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }

    if (!body.slug || !body.env || !body.worker || !body.client) {
      throw new HTTPException(400, {
        message: "Missing required fields: slug, env, worker, client",
      });
    }

    let platformConfig;
    try {
      platformConfig = loadPlatformConfig(body.env);
    } catch (err) {
      throw new HTTPException(400, {
        message: `Invalid platform config: ${(err as Error).message}`,
      });
    }

    const existing = slots.get(body.slug);
    if (existing?.live) {
      log.info("Replacing existing deploy", { slug: body.slug });
      existing.live.worker.terminate();
      const idx = agents.indexOf(existing.live);
      if (idx !== -1) agents.splice(idx, 1);
      existing.live = undefined;
      existing.initializing = undefined;
    }

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

    await kvSetAgent(kv, { slug: body.slug, env: body.env });

    slots.set(body.slug, {
      slug: body.slug,
      env: body.env,
      platformConfig,
      activeSessions: 0,
    });

    log.info("Deploy received", { slug: body.slug });
    return c.json({ ok: true, message: `Deployed ${body.slug}` });
  });

  return deploy;
}
