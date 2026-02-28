// Shared colored output helpers for CLI commands.

import { colors } from "@cliffy/ansi/colors";

export const log = {
  header(msg: string): void {
    console.log(colors.bold(msg));
  },

  success(msg: string): void {
    console.log(colors.green(`✓ ${msg}`));
  },

  info(msg: string): void {
    console.log(colors.dim(msg));
  },

  warn(msg: string): void {
    console.error(colors.yellow(msg));
  },

  error(msg: string): void {
    console.error(colors.red(msg));
  },

  agent(slug: string, detail?: string): void {
    console.log(
      detail ? `  ${colors.cyan(slug)} ${detail}` : `  ${colors.cyan(slug)}`,
    );
  },

  size(label: string, bytes: number): void {
    console.log(`    ${label}  ${(bytes / 1024).toFixed(1)}KB`);
  },

  timing(label: string, ms: number): void {
    console.log(colors.dim(`    ${label} (${Math.round(ms)}ms)`));
  },
};
