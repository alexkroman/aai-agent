// main.ts — Orchestrator entry point.
// Loads root .env, discovers all agents, spawns Workers, and starts serving.

import { createOrchestrator } from "./platform/orchestrator.ts";
import { configureLogger } from "./sdk/logger.ts";

// Best-effort .env loading
try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch {
  // .env not found or @std/dotenv not available — that's fine
}

configureLogger({
  logLevel: Deno.env.get("LOG_LEVEL"),
  denoEnv: Deno.env.get("DENO_ENV"),
});

const { app, agents } = await createOrchestrator({
  clientDir: Deno.env.get("CLIENT_DIR"),
});

const port = parseInt(Deno.env.get("PORT") ?? "3000");
Deno.serve({ port }, app.fetch);

console.log(`Orchestrator on http://localhost:${port}`);
for (const a of agents) {
  console.log(`  /${a.slug}/ → ${a.name}`);
}
