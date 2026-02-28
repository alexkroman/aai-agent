// deploy.ts — Discovers all bundles in dist/bundle/ and deploys each
// to the orchestrator via HTTP POST.
//
// Run from project root → deploys all bundles.
// Run from agents/night-owl/ → deploys only night-owl.

import { parseArgs } from "@std/cli/parse-args";
import { walk } from "@std/fs/walk";
import { discoverAgents } from "./_discover.ts";

const args = parseArgs(Deno.args, {
  string: ["url"],
  boolean: ["help"],
  default: { url: "http://localhost:3000" },
});

if (args.help) {
  console.log("Usage: deno task deploy [--url <url>] [--help]");
  Deno.exit(0);
}

// Use discovery to figure out which slugs to deploy
const agents = await discoverAgents();
const slugs = new Set(agents.map((a) => a.slug));

// ── Read bundles ────────────────────────────────────────────────
interface BundleEntry {
  slug: string;
  env: Record<string, string>;
  worker: string;
  client: string;
}

const bundles: BundleEntry[] = [];
const bundleRoot = "dist/bundle";

try {
  for await (
    const entry of walk(bundleRoot, {
      maxDepth: 2,
      includeDirs: false,
      match: [/manifest\.json$/],
    })
  ) {
    const dir = entry.path.replace(/\/manifest\.json$/, "");
    const slug = dir.split("/").pop()!;
    if (!slugs.has(slug)) continue;

    let manifest: { slug: string; env: Record<string, string> };
    let worker: string;
    let client: string;

    try {
      manifest = JSON.parse(await Deno.readTextFile(entry.path));
      worker = await Deno.readTextFile(`${dir}/worker.js`);
      client = await Deno.readTextFile(`${dir}/client.js`);
    } catch {
      console.warn(`  Skipping ${slug} — incomplete bundle`);
      continue;
    }

    bundles.push({ slug: manifest.slug, env: manifest.env, worker, client });
  }
} catch {
  console.error(
    `No bundles found in ${bundleRoot}/. Run \`deno task production\` first.`,
  );
  Deno.exit(1);
}

bundles.sort((a, b) => a.slug.localeCompare(b.slug));

if (bundles.length === 0) {
  console.error(
    `No bundles found in ${bundleRoot}/. Run \`deno task production\` first.`,
  );
  Deno.exit(1);
}

// ── Deploy each bundle ──────────────────────────────────────────
const url = `${args.url}/deploy`;
console.log(`Deploying ${bundles.length} bundle(s) to ${args.url}...\n`);

let failures = 0;

for (const bundle of bundles) {
  Deno.stdout.writeSync(new TextEncoder().encode(`  ${bundle.slug}...`));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    });

    if (resp.ok) {
      console.log(` deployed → ${args.url}/${bundle.slug}/`);
    } else {
      const text = await resp.text();
      console.log(` FAILED (${resp.status}): ${text}`);
      failures++;
    }
  } catch (err) {
    console.log(` FAILED: ${(err as Error).message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} deployment(s) failed.`);
  Deno.exit(1);
}

console.log("\nAll deployed successfully.");
