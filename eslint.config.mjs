import { createRequire } from "node:module";

const require = createRequire(
  new URL("./platform/package.json", import.meta.url),
);
const eslint = require("@eslint/js");
const globals = require("globals");

export default [
  { ignores: ["platform/", "node_modules/"] },
  eslint.configs.recommended,
  {
    files: ["examples/**/agent.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["examples/__tests__/**/*.test.js"],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
];
