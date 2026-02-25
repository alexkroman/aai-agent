import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/web-component.jsx"),
      formats: ["iife"],
      name: "AAIVoiceAgent",
      fileName: () => "aai-voice-agent.iife.js",
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
