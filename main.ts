// main.ts — Orchestrator entry point.
// Loads root .env, starts the deploy-based orchestrator, scans bundleDir.

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

const bundleDir = Deno.env.get("BUNDLE_DIR") ?? "bundles";
const { app, agents } = await createOrchestrator({ bundleDir });

const port = parseInt(Deno.env.get("PORT") ?? "3000");
Deno.serve({ port }, app.fetch);

console.log(`Orchestrator on http://localhost:${port}`);
console.log(`  Bundle dir: ${bundleDir}`);
for (const a of agents) {
  console.log(`  /${a.slug}/ → ${a.name}`);
}
