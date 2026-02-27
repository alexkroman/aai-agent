import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {},
  // Treat .worklet.js files as raw text (same as esbuild text loader)
  assetsInclude: [],
  plugins: [
    {
      name: "worklet-text-loader",
      transform(_code: string, id: string) {
        if (id.endsWith(".worklet.js")) {
          return {
            code: `export default "";`,
            map: null,
          };
        }
      },
    },
  ],
});
