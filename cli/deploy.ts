import { walk } from "@std/fs/walk";
import { log } from "./_output.ts";
import { type AgentEntry, discoverAgents } from "./_discover.ts";

export interface DeployOpts {
  url: string;
  bundleDir: string;
  dryRun: boolean;
}

export interface DeployDeps {
  discover: typeof discoverAgents;
  fetch: typeof globalThis.fetch;
  readTextFile: typeof Deno.readTextFile;
  walk: typeof walk;
  writeSync: typeof Deno.stdout.writeSync;
}

const defaultDeps: DeployDeps = {
  discover: discoverAgents,
  fetch: globalThis.fetch.bind(globalThis),
  readTextFile: Deno.readTextFile.bind(Deno),
  walk,
  writeSync: Deno.stdout.writeSync.bind(Deno.stdout),
};

interface BundleEntry {
  slug: string;
  env: Record<string, string>;
  worker: string;
  client: string;
}

export async function runDeploy(
  opts: DeployOpts,
  deps: DeployDeps = defaultDeps,
): Promise<void> {
  const agents = await deps.discover();
  const slugs = new Set(agents.map((a: AgentEntry) => a.slug));

  const bundles: BundleEntry[] = [];

  try {
    for await (
      const entry of deps.walk(opts.bundleDir, {
        maxDepth: 2,
        includeDirs: false,
        match: [/manifest\.json$/],
      })
    ) {
      const dir = entry.path.replace(/\/manifest\.json$/, "");
      const slug = dir.split("/").pop()!;
      if (!slugs.has(slug)) continue;

      try {
        const manifest: { slug: string; env: Record<string, string> } = JSON
          .parse(await deps.readTextFile(entry.path));
        const worker = await deps.readTextFile(`${dir}/worker.js`);
        const client = await deps.readTextFile(`${dir}/client.js`);
        bundles.push({
          slug: manifest.slug,
          env: manifest.env,
          worker,
          client,
        });
      } catch {
        log.warn(`  Skipping ${slug} — incomplete bundle`);
      }
    }
  } catch {
    log.error(
      `No bundles found in ${opts.bundleDir}/. Run \`deno task build\` first.`,
    );
    Deno.exit(1);
  }

  bundles.sort((a, b) => a.slug.localeCompare(b.slug));

  if (bundles.length === 0) {
    log.error(
      `No bundles found in ${opts.bundleDir}/. Run \`deno task build\` first.`,
    );
    Deno.exit(1);
  }

  if (opts.dryRun) {
    log.header(`Dry run — would deploy ${bundles.length} bundle(s):`);
    for (const b of bundles) {
      log.agent(b.slug, `→ ${opts.url}/${b.slug}/`);
    }
    return;
  }

  const url = `${opts.url}/deploy`;
  log.header(`Deploying ${bundles.length} bundle(s) to ${opts.url}...\n`);

  let failures = 0;

  for (const bundle of bundles) {
    deps.writeSync(new TextEncoder().encode(`  ${bundle.slug}...`));

    try {
      const resp = await deps.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });

      if (resp.ok) {
        log.success(`deployed → ${opts.url}/${bundle.slug}/`);
      } else {
        const text = await resp.text();
        log.error(` FAILED (${resp.status}): ${text}`);
        failures++;
      }
    } catch (err) {
      log.error(` FAILED: ${(err as Error).message}`);
      failures++;
    }
  }

  if (failures > 0) {
    log.error(`\n${failures} deployment(s) failed.`);
    Deno.exit(1);
  }

  log.success("All deployed successfully.");
}
