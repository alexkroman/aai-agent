import { Hono } from "@hono/hono";
import { FAVICON_SVG } from "../html.ts";

const favicon = new Hono();

const headers = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "public, max-age=86400",
};

favicon.get("/favicon.ico", (c) => c.body(FAVICON_SVG, { headers }));
favicon.get("/favicon.svg", (c) => c.body(FAVICON_SVG, { headers }));

export { favicon };
