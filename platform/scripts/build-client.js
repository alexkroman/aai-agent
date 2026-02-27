// build-client.js — Bundle client library files using esbuild.
// Produces dist/client.js (vanilla) and dist/react.js (React hook).

import { build } from "esbuild";
import { mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });

// Vanilla JS bundle — self-contained, no external dependencies
await build({
  entryPoints: ["client/client.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/client.js",
  minify: true,
  sourcemap: true,
  target: "es2022",
});

console.log("Built dist/client.js");

// React bundle — React is external (peer dependency from customer)
await build({
  entryPoints: ["client/react.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/react.js",
  minify: true,
  sourcemap: true,
  target: "es2022",
  external: ["react"],
});

console.log("Built dist/react.js");
