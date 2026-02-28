import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { runDeploy } from "./deploy.ts";
import type { DeployDeps } from "./deploy.ts";

describe("runDeploy", () => {
  function makeDeps(overrides: Partial<DeployDeps> = {}): DeployDeps {
    return {
      discover: () =>
        Promise.resolve([
          {
            slug: "agent-a",
            dir: "examples/agent-a",
            entryPoint: "examples/agent-a/agent.ts",
            env: { SLUG: "agent-a" },
            clientEntry: "ui/client.tsx",
          },
        ]),
      fetch: () => Promise.resolve(new Response("ok", { status: 200 })),
      readTextFile: (path: string | URL) => {
        const p = String(path);
        if (p.endsWith("manifest.json")) {
          return Promise.resolve(
            JSON.stringify({
              slug: "agent-a",
              env: { SLUG: "agent-a" },
            }),
          );
        }
        return Promise.resolve("// js content");
      },
      walk: async function* (root: string | URL) {
        yield {
          path: `${String(root)}/agent-a/manifest.json`,
          name: "manifest.json",
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      } as DeployDeps["walk"],
      writeSync: () => 0,
      ...overrides,
    };
  }

  it("deploys discovered bundles", async () => {
    const fetched: string[] = [];
    const deps = makeDeps({
      fetch: (input) => {
        fetched.push(String(input));
        return Promise.resolve(new Response("ok", { status: 200 }));
      },
    });

    await runDeploy(
      {
        url: "http://localhost:3000",
        bundleDir: "dist/bundle",
        dryRun: false,
      },
      deps,
    );
    expect(fetched).toEqual(["http://localhost:3000/deploy"]);
  });

  it("dry run does not call fetch", async () => {
    let fetchCalled = false;
    const deps = makeDeps({
      fetch: () => {
        fetchCalled = true;
        return Promise.resolve(new Response("ok"));
      },
    });

    await runDeploy(
      {
        url: "http://localhost:3000",
        bundleDir: "dist/bundle",
        dryRun: true,
      },
      deps,
    );
    expect(fetchCalled).toBe(false);
  });
});
