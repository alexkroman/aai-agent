// bundler.ts — Bundles each agent + platform runtime into a single JS file.
// Workers load these bundles with read: false for full filesystem isolation.
// Bundling is lazy — each agent is bundled on first access, not at startup.

import { build, type Plugin } from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { resolve } from "@std/path";

let mkdirDone = false;

/**
 * Bundle a single agent into a self-contained JS file at dist/workers/{slug}.js.
 * The bundle includes the agent code, the platform runtime (worker-entry.ts),
 * and all transitive dependencies (jsr:, local imports).
 */
export async function bundleAgent(slug: string): Promise<string> {
  if (!mkdirDone) {
    await Deno.mkdir("dist/workers", { recursive: true });
    mkdirDone = true;
  }

  const outfile = resolve("dist/workers", `${slug}.js`);
  const entryFile = resolve("dist/workers", `${slug}.entry.ts`);

  // Write a real entry file — the deno-resolver plugin needs actual files.
  const agentRelative = `../../agents/${slug}/agent.ts`;
  const workerEntryRelative = `../../sdk/worker-entry.ts`;

  await Deno.writeTextFile(
    entryFile,
    `import agent from "${agentRelative}";\n` +
      `import { startWorker } from "${workerEntryRelative}";\n` +
      `startWorker(agent);\n`,
  );

  const configPath = resolve("deno.json");

  await build({
    plugins: denoPlugins({ configPath }) as Plugin[],
    entryPoints: [entryFile],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    target: "es2022",
    // deno-dom loads .wasm dynamically at runtime — can't bundle that.
    // Server-only modules are excluded — workers never call Agent.routes()/serve().
    external: [
      "*.wasm",
      "*/server.ts",
      "*/config.ts",
      "@hono/*",
      "@std/dotenv",
    ],
  });

  // Clean up temp entry file
  await Deno.remove(entryFile).catch(() => {});

  return outfile;
}
