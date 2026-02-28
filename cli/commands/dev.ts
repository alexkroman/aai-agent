// dev command — Start development server with watch mode and hot-reload.

import { Command } from "@cliffy/command";
import { type BuildContext, context, type Plugin } from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { resolve } from "@std/path";
import { log } from "../_output.ts";
import { discoverAgents } from "../_discover.ts";
import { bundleAgent, workletTextPlugin } from "../_bundler.ts";
import type { AgentEntry } from "../_discover.ts";

const configPath = resolve("deno.json");

export interface DevOpts {
  port: number;
}

export interface DevDeps {
  discover: typeof discoverAgents;
  bundle: typeof bundleAgent;
  esbuildContext: typeof context;
  spawn: (bundleDir: string, port: number) => Deno.ChildProcess;
  makeTempDir: typeof Deno.makeTempDir;
  watchFs: typeof Deno.watchFs;
  addSignalListener: typeof Deno.addSignalListener;
  exit: typeof Deno.exit;
  removeSync: typeof Deno.removeSync;
}

const defaultDeps: DevDeps = {
  discover: discoverAgents,
  bundle: bundleAgent,
  esbuildContext: context,
  spawn: (bundleDir: string, _port: number) => {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        "--unstable-worker-options",
        "--unstable-kv",
        "main.ts",
      ],
      env: { ...Deno.env.toObject(), BUNDLE_DIR: bundleDir },
      stdout: "inherit",
      stderr: "inherit",
    });
    return cmd.spawn();
  },
  makeTempDir: Deno.makeTempDir.bind(Deno),
  watchFs: Deno.watchFs.bind(Deno),
  addSignalListener: Deno.addSignalListener.bind(Deno),
  exit: Deno.exit.bind(Deno),
  removeSync: Deno.removeSync.bind(Deno),
};

export async function runDev(
  opts: DevOpts,
  deps: DevDeps = defaultDeps,
): Promise<void> {
  const BUNDLE_DIR = await deps.makeTempDir({ prefix: "aai-dev-" });

  const agents = await deps.discover();
  if (agents.length === 0) {
    log.error("No agents found. Each needs agent.ts + .env with SLUG.");
    deps.exit(1);
  }

  // 1. Bundle all agents
  log.header(`Bundling ${agents.length} agent(s)...`);
  for (const agent of agents) {
    log.agent(agent.slug);
    const slugDir = `${BUNDLE_DIR}/${agent.slug}`;
    const { workerBytes, clientBytes } = await deps.bundle(agent, slugDir);
    log.size("worker.js", workerBytes);
    log.size("client.js", clientBytes);
  }

  // 2. esbuild watch for each client
  const clientContexts: BuildContext[] = [];
  for (const agent of agents) {
    const slugDir = `${BUNDLE_DIR}/${agent.slug}`;
    const ctx = await deps.esbuildContext({
      plugins: [workletTextPlugin, ...denoPlugins({ configPath }) as Plugin[]],
      entryPoints: [agent.clientEntry],
      bundle: true,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
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
  log.info("  esbuild watching clients");

  // 3. Start orchestrator
  let orchestrator = deps.spawn(BUNDLE_DIR, opts.port);

  // 4. Watch agent + sdk source -> re-bundle workers, restart
  const watchDirs = [
    ...agents.map((a: AgentEntry) => a.dir),
    "sdk",
    "platform",
  ];
  const watcher = deps.watchFs(watchDirs, { recursive: true });
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  (async () => {
    for await (const event of watcher) {
      const hasRelevantChange = event.paths.some((p: string) =>
        p.endsWith(".ts") || p.endsWith(".tsx")
      );
      if (!hasRelevantChange) continue;
      if (
        event.paths.every((p: string) =>
          p.includes("_test.ts") || p.includes("_worker_entry")
        )
      ) continue;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        log.info("\n  File change detected, rebuilding...");
        try {
          for (const agent of agents) {
            const slugDir = `${BUNDLE_DIR}/${agent.slug}`;
            await deps.bundle(agent, slugDir);
          }
          log.info("  Restarting orchestrator...");
          orchestrator.kill();
          await orchestrator.status.catch(() => {});
          orchestrator = deps.spawn(BUNDLE_DIR, opts.port);
        } catch (err) {
          log.error(`  Rebuild failed: ${(err as Error).message}`);
        }
      }, 300);
    }
  })();

  console.log(`\n  Agents:`);
  for (const a of agents) {
    console.log(`    http://localhost:${opts.port}/${a.slug}/`);
  }
  log.info("  Watching for changes...\n");

  // 5. Graceful shutdown
  const cleanup = () => {
    watcher.close();
    orchestrator.kill();
    for (const ctx of clientContexts) ctx.dispose();
    deps.removeSync(BUNDLE_DIR, { recursive: true });
    deps.exit(0);
  };

  deps.addSignalListener("SIGINT", cleanup);
  deps.addSignalListener("SIGTERM", cleanup);

  await orchestrator.status;
}

export const devCommand = new Command()
  .description("Start development server with watch mode and hot-reload.")
  .option("-p, --port <port:number>", "Server port.", { default: 3000 });
