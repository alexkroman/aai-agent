// Root CLI entry point for the aai agent development toolkit.

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { devCommand, runDev } from "./commands/dev.ts";
import { buildCommand, runBuild } from "./commands/build.ts";
import { deployCommand, runDeploy } from "./commands/deploy.ts";

// Wire actions here (not in the command modules) so tests can
// import and parse commands without triggering side effects.
buildCommand.action(async (options) => {
  await runBuild({ outDir: options.outDir });
});

deployCommand.action(async (options) => {
  await runDeploy({
    url: options.url,
    bundleDir: options.bundleDir,
    dryRun: options.dryRun ?? false,
  });
});

devCommand.action(async (options) => {
  await runDev({ port: options.port });
});

export const cli = new Command()
  .name("aai")
  .version("0.1.0")
  .description(
    "Agent development toolkit — build, serve, and deploy voice agents.",
  )
  .globalOption("--verbose", "Enable verbose output.")
  .command("dev", devCommand)
  .command("build", buildCommand)
  .command("deploy", deployCommand)
  .error((error, _cmd) => {
    console.error(colors.red(`error: ${error.message}`));
    Deno.exit(1);
  });

if (import.meta.main) {
  await cli.parse(Deno.args);
}
