// build-client.js — Bundle client library files using esbuild.
// Produces dist/client.js (vanilla) and dist/react.js (React hook).
// Copies example HTML files into dist/ for serving via dev:serve.

import { build } from "esbuild";
import { mkdirSync, cpSync, copyFileSync, writeFileSync, existsSync } from "fs";

mkdirSync("dist", { recursive: true });

// Copy example apps into dist/ so the server can serve them (skipped in production Docker builds)
if (existsSync("../examples")) {
  cpSync("../examples/travel-concierge", "dist/travel-concierge", { recursive: true });
  console.log("Copied examples/travel-concierge → dist/travel-concierge/");

  cpSync("../examples/math-buddy", "dist/math-buddy", { recursive: true });
  console.log("Copied examples/math-buddy → dist/math-buddy/");

  cpSync("../examples/techstore-support", "dist/techstore-support", { recursive: true });
  console.log("Copied examples/techstore-support → dist/techstore-support/");

  copyFileSync("../examples/index.html", "dist/index.html");
  console.log("Copied examples/index.html → dist/index.html");
} else {
  console.log("Skipping example copy (../examples not found)");
}

// Stub platform-config.js — in dev the fallback to window.location.origin is correct;
// in production the Fly entrypoint overwrites this with the real PLATFORM_URL.
// Named platform-config.js to avoid colliding with the server's config.js (from src/config.ts).
writeFileSync("dist/platform-config.js", 'window.__PLATFORM_URL__ = "";\n');
console.log("Wrote dist/platform-config.js (stub)");

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
