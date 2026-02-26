import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/**
 * Builds a self-contained IIFE bundle (React bundled in) for use in
 * plain HTML pages via a <script> tag. CSS is output as a separate
 * file loaded via <link> in the HTML template.
 */
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/iife-entry.ts"),
      formats: ["iife"],
      name: "AAIVoiceAgent",
      fileName: () => "aai-voice-agent.iife.js",
    },
    outDir: resolve(__dirname, "../../src/aai_agent/_template/static"),
    emptyOutDir: false,
  },
});
