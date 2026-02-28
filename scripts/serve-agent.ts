// serve-agent.ts — Run a single agent as a standalone server.
// Usage: deno run --allow-all scripts/serve-agent.ts agents/health-assistant/agent.ts

import { resolve, toFileUrl } from "@std/path";

const agentPath = Deno.args[0];
if (!agentPath) {
  console.error(
    "Usage: deno run --allow-all scripts/serve-agent.ts <agent-path>",
  );
  Deno.exit(1);
}

// Load .env
try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch {
  // .env not found or @std/dotenv not available
}

const mod = await import(toFileUrl(resolve(agentPath)).href);
const agent = mod.default;

const clientDir = Deno.env.get("CLIENT_DIR");
const app = await agent.routes({ clientDir });
const port = parseInt(Deno.env.get("PORT") ?? "3000");

Deno.serve({ port }, app.fetch);
console.log(`${agent.config.name} listening on http://localhost:${port}`);
