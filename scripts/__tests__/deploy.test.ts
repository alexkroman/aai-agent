import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { deployCommand, runDeploy } from "../commands/deploy.ts";
import type { DeployDeps } from "../commands/deploy.ts";

describe("deployCommand parsing", () => {
  function parse(args: string[]) {
    return deployCommand.reset().throwErrors().noExit().parse(args);
  }

  it("defaults --url to http://localhost:3000", async () => {
    const { options } = await parse([]);
    expect(options.url).toBe("http://localhost:3000");
  });

  it("accepts custom --url", async () => {
    const { options } = await parse(["--url", "http://prod:8080"]);
    expect(options.url).toBe("http://prod:8080");
  });

  it("accepts -u shorthand", async () => {
    const { options } = await parse(["-u", "http://prod:8080"]);
    expect(options.url).toBe("http://prod:8080");
  });

  it("defaults --bundle-dir to dist/bundle", async () => {
    const { options } = await parse([]);
    expect(options.bundleDir).toBe("dist/bundle");
  });

  it("accepts custom --bundle-dir", async () => {
    const { options } = await parse(["--bundle-dir", "/tmp/bundles"]);
    expect(options.bundleDir).toBe("/tmp/bundles");
  });

  it("defaults --dry-run to false", async () => {
    const { options } = await parse([]);
    expect(options.dryRun).toBeFalsy();
  });

  it("accepts --dry-run flag", async () => {
    const { options } = await parse(["--dry-run"]);
    expect(options.dryRun).toBe(true);
  });
});

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
