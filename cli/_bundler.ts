// Shared bundling logic used by both bundle.ts and dev.ts.
// Ensures dev always matches production output.

import { build, type Plugin } from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { resolve, toFileUrl } from "@std/path";

/** Loads .worklet.js files as text strings so they aren't executed as JS. */
export const workletTextPlugin: Plugin = {
  name: "worklet-text",
  setup(build) {
    build.onResolve({ filter: /\.worklet\.js$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "worklet-text",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "worklet-text" },
      async (args) => ({
        contents: await Deno.readTextFile(args.path),
        loader: "text" as const,
      }),
    );
  },
};
import type { AgentEntry } from "./_discover.ts";
import { agentToolsToSchemas } from "../platform/protocol.ts";
import type { ToolSchema } from "../platform/types.ts";

const configPath = resolve("deno.json");
const zodShimPath = resolve("cli/_zod_shim.ts");

// ── Pre-compute tool schemas using real zod ─────────────────────
async function precomputeSchemas(
  agent: AgentEntry,
): Promise<ToolSchema[]> {
  const mod = await import(toFileUrl(resolve(agent.entryPoint)).href);
  return agentToolsToSchemas(mod.default.tools);
}

export interface BundleResult {
  workerBytes: number;
  clientBytes: number;
}

/**
 * Bundle a single agent's worker + client + manifest into outDir.
 * Uses identical config for both dev and production:
 * - Pre-computes zod schemas at bundle time, aliases zod to a tiny shim
 * - Tree-shakes, minifies, strips debugger statements
 */
export async function bundleAgent(
  agent: AgentEntry,
  outDir: string,
): Promise<BundleResult> {
  await Deno.mkdir(outDir, { recursive: true });

  // Pre-compute schemas with real zod before aliasing it out
  const schemas = await precomputeSchemas(agent);

  // Worker — zod aliased to shim
  const tempEntry = resolve(outDir, "_worker_entry.ts");
  const agentAbsolute = resolve(agent.entryPoint);
  const workerEntryAbsolute = resolve("platform/worker_entry.ts");

  await Deno.writeTextFile(
    tempEntry,
    `import agent from "${agentAbsolute}";\n` +
      `import { startWorker } from "${workerEntryAbsolute}";\n` +
      `const secrets: Record<string, string> = ${
        JSON.stringify(agent.env)
      };\n` +
      `const schemas = ${JSON.stringify(schemas)};\n` +
      `startWorker(agent, secrets, schemas);\n`,
  );

  const workerResult = await build({
    plugins: denoPlugins({ configPath }) as Plugin[],
    entryPoints: [tempEntry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    outfile: `${outDir}/worker.js`,
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    alias: { "zod": zodShimPath },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    drop: ["debugger"],
    metafile: true,
    external: [
      "*.wasm",
      "*/server.ts",
      "*/config.ts",
      "@hono/*",
      "@std/dotenv",
    ],
  });
  await Deno.remove(tempEntry).catch(() => {});

  // Client — uses denoPlugins so import map entries (@aai/ui, preact, etc.) resolve
  const clientResult = await build({
    plugins: [workletTextPlugin, ...denoPlugins({ configPath }) as Plugin[]],
    entryPoints: [agent.clientEntry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    outfile: `${outDir}/client.js`,
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    drop: ["debugger"],
    metafile: true,
    loader: { ".worklet.js": "text" },
    jsx: "automatic",
    jsxImportSource: "preact",
  });

  // Manifest
  await Deno.writeTextFile(
    `${outDir}/manifest.json`,
    JSON.stringify({ slug: agent.slug, env: agent.env }, null, 2) + "\n",
  );

  // Extract sizes from metafile
  let workerBytes = 0;
  for (const [file, info] of Object.entries(workerResult.metafile!.outputs)) {
    if (file.endsWith(".js")) workerBytes = info.bytes;
  }
  let clientBytes = 0;
  for (const [file, info] of Object.entries(clientResult.metafile!.outputs)) {
    if (file.endsWith(".js")) clientBytes = info.bytes;
  }

  return { workerBytes, clientBytes };
}
