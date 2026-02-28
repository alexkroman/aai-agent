import type { Hono } from "@hono/hono";
import { compress } from "@hono/hono/compress";
import { cors } from "@hono/hono/cors";
import { HTTPException } from "@hono/hono/http-exception";
import { createLogger } from "../sdk/logger.ts";

const log = createLogger("middleware");

export { HTTPException };

export function applyMiddleware(app: Hono): void {
  app.use("*", cors());
  app.use("*", compress());
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error({ err, path: c.req.path }, "Unhandled error");
    return c.json({ error: "Internal server error" }, 500);
  });
}
