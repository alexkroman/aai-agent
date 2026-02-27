// build-client.js — Bundle client library files using esbuild.
// Produces dist/client.js (vanilla) and dist/react.js (React hook).
// Copies example HTML files into dist/ for serving via dev:serve.

import { build } from "esbuild";
import { mkdirSync, cpSync, copyFileSync, existsSync } from "fs";
import { execSync } from "child_process";

mkdirSync("dist", { recursive: true });

// Copy example apps into dist/ so the server can serve them
cpSync("../examples/vanilla", "dist/vanilla", { recursive: true });
console.log("Copied examples/vanilla → dist/vanilla/");

cpSync("../examples/vanilla-calculator", "dist/vanilla-calculator", { recursive: true });
console.log("Copied examples/vanilla-calculator → dist/vanilla-calculator/");

// Build React example into dist/react/
const reactDir = "../examples/react";
if (!existsSync(`${reactDir}/node_modules`)) {
  execSync("npm install", { cwd: reactDir, stdio: "inherit" });
}
execSync("npx vite build --outDir ../../platform/dist/react", {
  cwd: reactDir,
  stdio: "inherit",
});
console.log("Built examples/react → dist/react/");

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
