// dev.ts — Discovers agents, bundles them (identical to production),
// starts the orchestrator, and watches for changes (auto-rebuilds
// worker + client, restarts orchestrator).
//
// Run from project root → serves all agents.
// Run from agents/night-owl/ → serves only night-owl.

import { parseArgs } from "@std/cli/parse-args";
import { type BuildContext, context } from "esbuild";
import { discoverAgents } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";

const args = parseArgs(Deno.args, { boolean: ["help"] });
if (args.help) {
  console.log("Usage: deno task dev [--help]");
  Deno.exit(0);
}

// Use a temp directory so the orchestrator only sees agents we bundled,
// not stale deploys left over from previous runs.
const BUNDLE_DIR = await Deno.makeTempDir({ prefix: "aai-dev-" });

// ── Main ────────────────────────────────────────────────────────
const agents = await discoverAgents();
if (agents.length === 0) {
  console.error(
    "No agents found. Each needs agent.ts + .env with SLUG.",
  );
  Deno.exit(1);
}

// ── 1. Bundle all agents (same pipeline as production) ──────────
console.log(`Bundling ${agents.length} agent(s)...`);
for (const agent of agents) {
  console.log(`  ${agent.slug}`);
  const slugDir = `${BUNDLE_DIR}/${agent.slug}`;
  const { workerBytes, clientBytes } = await bundleAgent(agent, slugDir);
  console.log(`    worker.js  ${(workerBytes / 1024).toFixed(1)}KB`);
  console.log(`    client.js  ${(clientBytes / 1024).toFixed(1)}KB`);
}

// ── 2. esbuild watch for each client (live reload) ──────────────
const clientContexts: BuildContext[] = [];
for (const agent of agents) {
  const slugDir = `${BUNDLE_DIR}/${agent.slug}`;
  const ctx = await context({
    entryPoints: [agent.clientEntry],
    bundle: true,
    format: "esm",
    outfile: `${slugDir}/client.js`,
    sourcemap: true,
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    drop: ["debugger"],
    loader: { ".worklet.js": "text" },
    jsx: "automatic",
    jsxImportSource: "preact",
  });
  await ctx.watch();
  clientContexts.push(ctx);
}
console.log("  esbuild watching clients");

// ── 3. Start orchestrator ───────────────────────────────────────
function startOrchestrator(): Deno.ChildProcess {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      "--unstable-worker-options",
      "--unstable-kv",
      "main.ts",
    ],
    env: { ...Deno.env.toObject(), BUNDLE_DIR },
    stdout: "inherit",
    stderr: "inherit",
  });
  return cmd.spawn();
}

let orchestrator = startOrchestrator();

// ── 4. Watch agent + sdk source → re-bundle workers, restart ────
const watchDirs = [
  ...agents.map((a) => a.dir),
  "sdk",
];
const watcher = Deno.watchFs(watchDirs, { recursive: true });
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

(async () => {
  for await (const event of watcher) {
    const hasRelevantChange = event.paths.some((p) =>
      p.endsWith(".ts") || p.endsWith(".tsx")
    );
    if (!hasRelevantChange) continue;
    if (
      event.paths.every((p) =>
        p.includes("__tests__") || p.includes("_worker-entry")
      )
    ) continue;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log("\n  File change detected, rebuilding...");
      try {
        for (const agent of agents) {
          const slugDir = `${BUNDLE_DIR}/${agent.slug}`;
          await bundleAgent(agent, slugDir);
        }
        console.log("  Restarting orchestrator...");
        orchestrator.kill();
        await orchestrator.status.catch(() => {});
        orchestrator = startOrchestrator();
      } catch (err) {
        console.error("  Rebuild failed:", (err as Error).message);
      }
    }, 300);
  }
})();

console.log(`\n  Agents:`);
for (const a of agents) {
  console.log(`    http://localhost:3000/${a.slug}/`);
}
console.log("  Watching for changes...\n");

// ── 5. Graceful shutdown ────────────────────────────────────────
const cleanup = () => {
  watcher.close();
  orchestrator.kill();
  for (const ctx of clientContexts) ctx.dispose();
  Deno.removeSync(BUNDLE_DIR, { recursive: true });
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", cleanup);
Deno.addSignalListener("SIGTERM", cleanup);

await orchestrator.status;
