import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildCommand, runBuild } from "./build.ts";
import type { BuildDeps } from "./build.ts";
import type { AgentEntry } from "../_discover.ts";

const fakeAgent: AgentEntry = {
  slug: "test-agent",
  dir: "examples/test-agent",
  entryPoint: "examples/test-agent/agent.ts",
  env: { SLUG: "test-agent" },
  clientEntry: "ui/client.tsx",
};

describe("buildCommand parsing", () => {
  function parse(args: string[]) {
    return buildCommand.reset().throwErrors().noExit().parse(args);
  }

  it("defaults --out-dir to dist/bundle", async () => {
    const { options } = await parse([]);
    expect(options.outDir).toBe("dist/bundle");
  });

  it("accepts custom --out-dir", async () => {
    const { options } = await parse(["--out-dir", "/tmp/out"]);
    expect(options.outDir).toBe("/tmp/out");
  });

  it("accepts -o shorthand", async () => {
    const { options } = await parse(["-o", "/tmp/out"]);
    expect(options.outDir).toBe("/tmp/out");
  });
});

describe("runBuild", () => {
  it("bundles all discovered agents", async () => {
    const bundled: string[] = [];

    const deps: BuildDeps = {
      discover: () => Promise.resolve([fakeAgent]),
      bundle: (agent, _outDir) => {
        bundled.push(agent.slug);
        return Promise.resolve({ workerBytes: 1024, clientBytes: 512 });
      },
    };

    await runBuild({ outDir: "dist/bundle" }, deps);
    expect(bundled).toEqual(["test-agent"]);
  });

  it("bundles into the specified output directory", async () => {
    const dirs: string[] = [];

    const deps: BuildDeps = {
      discover: () => Promise.resolve([fakeAgent]),
      bundle: (_agent, outDir) => {
        dirs.push(outDir);
        return Promise.resolve({ workerBytes: 100, clientBytes: 100 });
      },
    };

    await runBuild({ outDir: "/custom/path" }, deps);
    expect(dirs).toEqual(["/custom/path/test-agent"]);
  });
});
