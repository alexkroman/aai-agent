import { log } from "./_output.ts";
import { discoverAgents } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";

export interface BuildOpts {
  outDir: string;
}

export async function runBuild(
  opts: BuildOpts,
  discover = discoverAgents,
  bundle = bundleAgent,
): Promise<void> {
  const agents = await discover();
  if (agents.length === 0) {
    log.error("No agents found. Each needs agent.ts + .env with SLUG.");
    Deno.exit(1);
  }

  log.header(`Bundling ${agents.length} agent(s)...\n`);

  for (const agent of agents) {
    const t0 = performance.now();
    log.agent(agent.slug);
    const outDir = `${opts.outDir}/${agent.slug}`;
    const result = await bundle(agent, outDir);
    log.size("worker.js", result.workerBytes);
    log.size("client.js", result.clientBytes);
    log.timing("done", performance.now() - t0);
  }

  log.success(`Bundles ready in ${opts.outDir}/`);
}
