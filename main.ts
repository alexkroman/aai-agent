import { createOrchestrator } from "./server/orchestrator.ts";

try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch { /* .env not found — fine */ }

const bundleDir = Deno.env.get("BUNDLE_DIR") ?? "dist/bundle";
const { app, agents } = await createOrchestrator({ bundleDir });

const port = parseInt(Deno.env.get("PORT") ?? "3000");
Deno.serve({ port }, app.fetch);

console.log(`Orchestrator on http://localhost:${port}`);
console.log(`  Bundle dir: ${bundleDir}`);
for (const a of agents) {
  console.log(`  /${a.slug}/ → ${a.name}`);
}
