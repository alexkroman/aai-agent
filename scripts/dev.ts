// dev.ts — Dev script: builds client, then runs agent(s) with --watch.
// Usage:
//   deno task dev                              → orchestrator mode (all agents)
//   deno task dev agents/code-interpreter/agent.ts → single-agent mode

import { context } from "esbuild";

const agentPath = Deno.args[0];

const BUNDLE_DIR = "dist/client";
await Deno.mkdir(BUNDLE_DIR, { recursive: true });

// ── 1. esbuild watch for client bundles ────────────────────────

const ctx = await context({
  entryPoints: ["ui/client.tsx"],
  bundle: true,
  format: "esm",
  outdir: BUNDLE_DIR,
  sourcemap: true,
  target: "es2022",
  loader: { ".worklet.js": "text" },
  jsx: "automatic",
  jsxImportSource: "preact",
});

await ctx.watch();
console.log("  esbuild watching client bundles");

// ── 2. Run either orchestrator or single agent ─────────────────

const denoArgs = agentPath
  ? [
    "run",
    "--watch",
    "--allow-all",
    "--unstable-worker-options",
    "scripts/serve-agent.ts",
    agentPath,
  ]
  : ["run", "--watch", "--allow-all", "--unstable-worker-options", "main.ts"];

const cmd = new Deno.Command("deno", {
  args: denoArgs,
  env: {
    ...Object.fromEntries(
      [...Object.entries(Deno.env.toObject())],
    ),
    CLIENT_DIR: BUNDLE_DIR,
  },
  stdout: "inherit",
  stderr: "inherit",
});

const process = cmd.spawn();
if (agentPath) {
  console.log(`  Agent: ${agentPath}`);
} else {
  console.log("  Orchestrator: main.ts (all agents)");
}

// ── 3. Graceful shutdown ───────────────────────────────────────

const cleanup = () => {
  process.kill();
  ctx.dispose();
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", cleanup);
Deno.addSignalListener("SIGTERM", cleanup);

await process.status;
