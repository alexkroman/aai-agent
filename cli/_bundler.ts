import { build, type Plugin } from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { resolve, toFileUrl } from "@std/path";
import type { AgentEntry } from "./_discover.ts";
import { agentToolsToSchemas } from "../server/protocol.ts";

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

// Stubs for platform-only modules that carry heavy deps (WASM, native libs).
// The worker never calls these — it only needs agent data + tool execution.
const WORKER_STUBS: Record<string, string> = {
  "builtin_tools": [
    "export function getBuiltinToolSchemas() { return []; }",
    "export function executeBuiltinTool() { return null; }",
    "export function htmlToText() { return ''; }",
  ].join("\n"),
  "config":
    "export function loadPlatformConfig() { throw new Error('unavailable in worker'); }",
};

const serverDir = resolve("server");

const workerStubPlugin: Plugin = {
  name: "worker-stub",
  setup(b) {
    b.onResolve(
      { filter: /builtin_tools\.ts$|\/config\.ts$/ },
      (args) => {
        const full = resolve(args.resolveDir, args.path);
        if (!full.startsWith(serverDir)) return undefined;
        const base = full.split("/").pop()!.replace(".ts", "");
        if (!WORKER_STUBS[base]) return undefined;
        return { path: base, namespace: "worker-stub" };
      },
    );
    b.onLoad({ filter: /.*/, namespace: "worker-stub" }, (args) => ({
      contents: WORKER_STUBS[args.path] ?? "export {}",
      loader: "ts",
    }));
  },
};

const configPath = resolve("deno.json");
const zodShimPath = resolve("cli/_zod_shim.ts");

async function precomputeSchemas(agent: AgentEntry) {
  const mod = await import(toFileUrl(resolve(agent.entryPoint)).href);
  return agentToolsToSchemas(mod.default.tools);
}

function jsBytes(metafile: { outputs: Record<string, { bytes: number }> }) {
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (file.endsWith(".js")) return info.bytes;
  }
  return 0;
}

export interface BundleResult {
  workerBytes: number;
  clientBytes: number;
}

export async function bundleAgent(
  agent: AgentEntry,
  outDir: string,
): Promise<BundleResult> {
  await Deno.mkdir(outDir, { recursive: true });

  const schemas = await precomputeSchemas(agent);

  const tempEntry = resolve(outDir, "_worker_entry.ts");
  const agentAbsolute = resolve(agent.entryPoint);
  const workerEntryAbsolute = resolve("server/worker_entry.ts");

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
    plugins: [workerStubPlugin, ...denoPlugins({ configPath }) as Plugin[]],
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
    define: { "process.env.NODE_ENV": '"production"' },
    drop: ["debugger"],
    metafile: true,
    external: ["@hono/*", "@std/dotenv"],
    logOverride: { "commonjs-variable-in-esm": "silent" },
  });
  await Deno.remove(tempEntry).catch(() => {});

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
    define: { "process.env.NODE_ENV": '"production"' },
    drop: ["debugger"],
    metafile: true,
    loader: { ".worklet.js": "text" },
    jsx: "automatic",
    jsxImportSource: "preact",
    logOverride: { "commonjs-variable-in-esm": "silent" },
  });

  await Deno.writeTextFile(
    `${outDir}/manifest.json`,
    JSON.stringify({ slug: agent.slug, env: agent.env }, null, 2) + "\n",
  );

  return {
    workerBytes: jsBytes(workerResult.metafile!),
    clientBytes: jsBytes(clientResult.metafile!),
  };
}
