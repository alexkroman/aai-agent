// build-client.ts — Bundle browser SDK using esbuild (Deno).
// Produces dist/client/client.js (vanilla JS widget).

import { build } from "esbuild";

const BUNDLE_DIR = "dist/client";

await Deno.mkdir(BUNDLE_DIR, { recursive: true });

await build({
  entryPoints: ["ui/client.tsx"],
  bundle: true,
  format: "esm",
  outfile: `${BUNDLE_DIR}/client.js`,
  minify: true,
  sourcemap: true,
  target: "es2022",
  loader: { ".worklet.js": "text" },
  jsx: "automatic",
  jsxImportSource: "preact",
});

console.log(`Built ${BUNDLE_DIR}/client.js`);

// Ensure esbuild exits cleanly in Deno
Deno.exit(0);
