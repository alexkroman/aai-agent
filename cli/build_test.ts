import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { runBuild } from "./build.ts";
import type { AgentEntry } from "./_discover.ts";

const fakeAgent: AgentEntry = {
  slug: "test-agent",
  dir: "examples/test-agent",
  entryPoint: "examples/test-agent/agent.ts",
  env: { SLUG: "test-agent" },
  clientEntry: "ui/client.tsx",
};

describe("runBuild", () => {
  it("bundles all discovered agents", async () => {
    const bundled: string[] = [];

    await runBuild(
      { outDir: "dist/bundle" },
      () => Promise.resolve([fakeAgent]),
      (agent, _outDir) => {
        bundled.push(agent.slug);
        return Promise.resolve({ workerBytes: 1024, clientBytes: 512 });
      },
    );
    expect(bundled).toEqual(["test-agent"]);
  });

  it("bundles into the specified output directory", async () => {
    const dirs: string[] = [];

    await runBuild(
      { outDir: "/custom/path" },
      () => Promise.resolve([fakeAgent]),
      (_agent, outDir) => {
        dirs.push(outDir);
        return Promise.resolve({ workerBytes: 100, clientBytes: 100 });
      },
    );
    expect(dirs).toEqual(["/custom/path/test-agent"]);
  });
});
