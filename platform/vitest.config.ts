import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "/client.js": fileURLToPath(
        new URL("../examples/__tests__/_mock-client.js", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "src/__tests__/**/*.test.ts",
      "client/__tests__/**/*.test.ts",
      "../examples/**/__tests__/**/*.test.js",
    ],
    exclude: ["dist/**", "node_modules/**"],
  },
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
