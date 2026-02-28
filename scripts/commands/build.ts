// build command — Bundle agents for production into dist/bundle/.

import { Command } from "@cliffy/command";
import { log } from "../_output.ts";
import { discoverAgents } from "../_discover.ts";
import { bundleAgent } from "../_bundler.ts";
import type { BundleResult } from "../_bundler.ts";

export interface BuildOpts {
  outDir: string;
}

export interface BuildDeps {
  discover: typeof discoverAgents;
  bundle: typeof bundleAgent;
}

const defaultDeps: BuildDeps = {
  discover: discoverAgents,
  bundle: bundleAgent,
};

export async function runBuild(
  opts: BuildOpts,
  deps: BuildDeps = defaultDeps,
): Promise<void> {
  const agents = await deps.discover();
  if (agents.length === 0) {
    log.error("No agents found. Each needs agent.ts + .env with SLUG.");
    Deno.exit(1);
  }

  log.header(`Bundling ${agents.length} agent(s)...\n`);

  for (const agent of agents) {
    const t0 = performance.now();
    log.agent(agent.slug);
    const outDir = `${opts.outDir}/${agent.slug}`;
    const result: BundleResult = await deps.bundle(agent, outDir);
    log.size("worker.js", result.workerBytes);
    log.size("client.js", result.clientBytes);
    log.timing("done", performance.now() - t0);
  }

  log.success(`Bundles ready in ${opts.outDir}/`);
}

export const buildCommand = new Command()
  .description("Bundle agents for production into dist/bundle/.")
  .option("-o, --out-dir <dir:string>", "Output directory.", {
    default: "dist/bundle",
  });
