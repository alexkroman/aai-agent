// build-client.js — Bundle client library files using esbuild.
// Produces dist/client.js (vanilla) and dist/react.js (React hook).
// Copies example HTML files into dist/ for serving via dev:serve.

import { build } from "esbuild";
import { mkdirSync, cpSync, copyFileSync } from "fs";

mkdirSync("dist", { recursive: true });

// Copy example apps into dist/ so the server can serve them
cpSync("../examples/travel-concierge", "dist/travel-concierge", { recursive: true });
console.log("Copied examples/travel-concierge → dist/travel-concierge/");

cpSync("../examples/math-buddy", "dist/math-buddy", { recursive: true });
console.log("Copied examples/math-buddy → dist/math-buddy/");

cpSync("../examples/techstore-support", "dist/techstore-support", { recursive: true });
console.log("Copied examples/techstore-support → dist/techstore-support/");

// Copy root index page from examples/
copyFileSync("../examples/index.html", "dist/index.html");
console.log("Copied examples/index.html → dist/index.html");

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
