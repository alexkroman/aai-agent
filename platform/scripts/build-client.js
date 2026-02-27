// build-client.js — Bundle client library files using esbuild.
// Produces dist/client.js (vanilla) and dist/react.js (React hook).
// Copies example HTML files into dist/ for serving via dev:serve.

import { build } from "esbuild";
import { mkdirSync, cpSync, copyFileSync, existsSync, readdirSync, statSync } from "fs";

mkdirSync("dist", { recursive: true });

// Copy example apps into dist/ so the server can serve them (skipped in production Docker builds)
if (existsSync("../examples")) {
  for (const entry of readdirSync("../examples")) {
    const src = `../examples/${entry}`;
    if (statSync(src).isDirectory()) {
      cpSync(src, `dist/${entry}`, { recursive: true });
      console.log(`Copied examples/${entry} → dist/${entry}/`);
    } else if (entry.endsWith(".html")) {
      copyFileSync(src, `dist/${entry}`);
      console.log(`Copied examples/${entry} → dist/${entry}`);
    }
  }
} else {
  console.log("Skipping example copy (../examples not found)");
}

// Shared esbuild loader: inline worklet JS files as text strings
const workletLoader = {
  ".worklet.js": "text",
};

// Vanilla JS bundle — self-contained, no external dependencies
await build({
  entryPoints: ["client/client.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/client.js",
  minify: true,
  sourcemap: true,
  target: "es2022",
  loader: workletLoader,
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
  loader: workletLoader,
});

console.log("Built dist/react.js");
