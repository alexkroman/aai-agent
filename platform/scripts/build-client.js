// build-client.js — Bundle client library files using esbuild.
// Produces dist/client.js (vanilla) and dist/react.js (React hook).
// Copies example HTML files into dist/ for serving via dev:serve.

import { build } from "esbuild";
import { mkdirSync, cpSync } from "fs";

mkdirSync("dist", { recursive: true });

// Copy example apps into dist/ so the server can serve them
cpSync("../examples/vanilla", "dist/vanilla", { recursive: true });
console.log("Copied examples/vanilla → dist/vanilla/");

// Write a root index page linking to examples
import { writeFileSync } from "fs";
writeFileSync("dist/index.html", `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><link rel="icon" href="/favicon.svg"><title>aai-agent</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px;">
  <h1>aai-agent</h1>
  <ul>
    <li><a href="/vanilla/">Vanilla JS — Travel Concierge</a></li>
    <li><a href="/health">Health check</a></li>
  </ul>
</body>
</html>
`);
console.log("Wrote dist/index.html");

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
