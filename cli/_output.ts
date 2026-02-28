// Shared colored output helpers for CLI commands.

import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";

export const log = {
  header(msg: string): void {
    console.log(bold(msg));
  },

  success(msg: string): void {
    console.log(green(`✓ ${msg}`));
  },

  info(msg: string): void {
    console.log(dim(msg));
  },

  warn(msg: string): void {
    console.error(yellow(msg));
  },

  error(msg: string): void {
    console.error(red(msg));
  },

  agent(slug: string, detail?: string): void {
    console.log(
      detail ? `  ${cyan(slug)} ${detail}` : `  ${cyan(slug)}`,
    );
  },

  size(label: string, bytes: number): void {
    console.log(`    ${label}  ${(bytes / 1024).toFixed(1)}KB`);
  },

  timing(label: string, ms: number): void {
    console.log(dim(`    ${label} (${Math.round(ms)}ms)`));
  },
};
