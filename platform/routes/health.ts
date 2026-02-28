import { Hono } from "@hono/hono";

export function createHealthRoute(
  getStatus?: () => Record<string, unknown>,
): Hono {
  const health = new Hono();
  health.get("/health", (c) => c.json({ status: "ok", ...getStatus?.() }));
  return health;
}
