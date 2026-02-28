import { parseArgs } from "@std/cli/parse-args";
import { red } from "@std/fmt/colors";

function printUsage(): void {
  console.log(`aai — Agent development toolkit

Usage: aai <command> [options]

Commands:
  dev      Start development server with watch mode and hot-reload
  build    Bundle agents for production into dist/bundle/
  deploy   Deploy bundled agents to a running orchestrator

Options:
  -h, --help       Show this help message
  -V, --version    Show version number

Run 'aai <command> --help' for command-specific options.`);
}

export async function main(args: string[]): Promise<number> {
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }
  if (command === "--version" || command === "-V") {
    console.log("0.1.0");
    return 0;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    switch (command) {
      case "dev":
        console.log(`aai dev — Start development server

Options:
  -p, --port <number>  Server port (default: 3000)`);
        return 0;
      case "build":
        console.log(`aai build — Bundle agents for production

Options:
  -o, --out-dir <dir>  Output directory (default: dist/bundle)`);
        return 0;
      case "deploy":
        console.log(`aai deploy — Deploy bundled agents

Options:
  -u, --url <url>          Orchestrator URL (default: http://localhost:3000)
      --bundle-dir <dir>   Bundle directory (default: dist/bundle)
      --dry-run            Show what would be deployed without sending`);
        return 0;
      default:
        console.error(red(`error: unknown command '${command}'`));
        printUsage();
        return 1;
    }
  }

  switch (command) {
    case "dev": {
      const flags = parseArgs(rest, {
        string: ["port"],
        alias: { p: "port" },
      });
      const { runDev } = await import("./dev.ts");
      await runDev({ port: Number(flags.port) || 3000 });
      return 0;
    }
    case "build": {
      const flags = parseArgs(rest, {
        string: ["out-dir"],
        alias: { o: "out-dir" },
      });
      const { runBuild } = await import("./build.ts");
      await runBuild({ outDir: flags["out-dir"] || "dist/bundle" });
      return 0;
    }
    case "deploy": {
      const flags = parseArgs(rest, {
        boolean: ["dry-run"],
        string: ["url", "bundle-dir"],
        alias: { u: "url" },
      });
      const { runDeploy } = await import("./deploy.ts");
      await runDeploy({
        url: flags.url || "http://localhost:3000",
        bundleDir: flags["bundle-dir"] || "dist/bundle",
        dryRun: !!flags["dry-run"],
      });
      return 0;
    }
    default:
      console.error(red(`error: unknown command '${command}'`));
      printUsage();
      return 1;
  }
}

if (import.meta.main) {
  const code = await main(Deno.args);
  if (code !== 0) Deno.exit(code);
}
