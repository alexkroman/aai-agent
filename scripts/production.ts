// production.ts — Discovers agents and bundles each one into
// dist/bundle/<slug>/{worker.js, client.js, manifest.json}.
//
// Run from project root → bundles all agents.
// Run from agents/night-owl/ → bundles only night-owl.

import { parseArgs } from "@std/cli/parse-args";
import { discoverAgents } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";

const args = parseArgs(Deno.args, { boolean: ["help"] });
if (args.help) {
  console.log("Usage: deno task production [--help]");
  Deno.exit(0);
}

const agents = await discoverAgents();
if (agents.length === 0) {
  console.error(
    "No agents found. Each needs agent.ts + .env with SLUG.",
  );
  Deno.exit(1);
}

console.log(`Bundling ${agents.length} agent(s)...\n`);

for (const agent of agents) {
  const t0 = performance.now();
  console.log(`  ${agent.slug}`);
  const outDir = `dist/bundle/${agent.slug}`;
  const { workerBytes, clientBytes } = await bundleAgent(agent, outDir);
  console.log(`    worker.js  ${(workerBytes / 1024).toFixed(1)}KB`);
  console.log(`    client.js  ${(clientBytes / 1024).toFixed(1)}KB`);
  console.log(`    done (${Math.round(performance.now() - t0)}ms)`);
}

console.log(`\nBundles ready in dist/bundle/`);

Deno.exit(0);
