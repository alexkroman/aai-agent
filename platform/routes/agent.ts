import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { getLogger } from "../../sdk/logger.ts";
import { renderAgentPage } from "../html.ts";
import { FAVICON_SVG } from "../html.ts";
import { handleSessionWebSocket } from "../ws_handler.ts";
import { createServerSession } from "../session_factory.ts";
import { ServerSession } from "../session.ts";
import {
  type AgentInfo,
  type AgentSlot,
  createComlinkExecutor,
  ensureAgent,
  trackSessionClose,
  trackSessionOpen,
} from "../worker_pool.ts";

const log = getLogger("agent-routes");

export function createAgentRoutes(ctx: {
  slots: Map<string, AgentSlot>;
  agents: AgentInfo[];
  sessions: Map<string, ServerSession>;
  bundleDir: string;
}): Hono {
  const { slots, agents, sessions, bundleDir } = ctx;
  const routes = new Hono();

  routes.get("/:slug/", async (c) => {
    const slug = c.req.param("slug");
    const slot = slots.get(slug);
    if (!slot) throw new HTTPException(404, { message: "Agent not found" });

    try {
      const info = await ensureAgent(slot, bundleDir);
      if (!agents.includes(info)) agents.push(info);
      return c.html(renderAgentPage(info.name, `/${slug}`));
    } catch (err) {
      log.error("Failed to initialize agent", { slug, err });
      throw new HTTPException(500, {
        message: "Agent failed to initialize",
      });
    }
  });

  routes.get("/:slug", (c) => {
    const slug = c.req.param("slug");
    if (!slots.has(slug)) {
      throw new HTTPException(404, { message: "Agent not found" });
    }
    return c.redirect(`/${slug}/`, 301);
  });

  routes.get("/:slug/session", async (c) => {
    const slug = c.req.param("slug");
    const slot = slots.get(slug);
    if (!slot) throw new HTTPException(404, { message: "Agent not found" });

    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      throw new HTTPException(400, {
        message: "Expected WebSocket upgrade",
      });
    }

    let info: AgentInfo;
    try {
      info = await ensureAgent(slot, bundleDir);
      if (!agents.includes(info)) agents.push(info);
    } catch (err) {
      log.error("Failed to initialize agent for session", { slug, err });
      throw new HTTPException(500, {
        message: "Agent failed to initialize",
      });
    }

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    handleSessionWebSocket(socket, sessions, {
      createSession: (sessionId, ws) => {
        const executeTool = createComlinkExecutor(info.workerApi);
        return createServerSession(
          sessionId,
          ws,
          info.config,
          info.toolSchemas,
          { platformConfig: slot.platformConfig, executeTool },
        );
      },
      logContext: { slug: info.slug },
      onOpen: () => trackSessionOpen(slot),
      onClose: () => trackSessionClose(slot, agents),
    });
    return response;
  });

  routes.get("/:slug/client.js", async (c) => {
    const slug = c.req.param("slug");
    if (!slots.has(slug)) {
      throw new HTTPException(404, { message: "Agent not found" });
    }

    try {
      const content = await Deno.readFile(`${bundleDir}/${slug}/client.js`);
      return c.body(content, {
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      throw new HTTPException(404, { message: "Not found" });
    }
  });

  routes.get("/:slug/client.js.map", async (c) => {
    const slug = c.req.param("slug");
    if (!slots.has(slug)) {
      throw new HTTPException(404, { message: "Agent not found" });
    }

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
      throw new HTTPException(404, { message: "Not found" });
    }
  });

  routes.get("/:slug/favicon.svg", (c) =>
    c.body(FAVICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    }));

  return routes;
}
