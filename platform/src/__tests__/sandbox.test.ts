import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Sandbox } from "../sandbox.js";

describe("Sandbox", () => {
  it("executes a simple handler returning a string", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "greet",
          handler: 'async (args) => `Hello, ${args.name}!`',
        },
      ],
      {}
    );

    const result = await sandbox.execute("greet", { name: "World" });
    expect(result).toBe("Hello, World!");
    sandbox.dispose();
  });

  it("executes a handler returning an object (auto-stringified)", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "get_data",
          handler: "async (args) => ({ status: 'ok', value: args.x * 2 })",
        },
      ],
      {}
    );

    const result = await sandbox.execute("get_data", { x: 21 });
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ status: "ok", value: 42 });
    sandbox.dispose();
  });

  it("injects ctx.secrets", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "use_secret",
          handler: "async (args, ctx) => ctx.secrets.MY_KEY",
        },
      ],
      { MY_KEY: "secret-value-123" }
    );

    const result = await sandbox.execute("use_secret", {});
    expect(result).toBe("secret-value-123");
    sandbox.dispose();
  });

  it("secrets are copies (mutations don't leak)", async () => {
    const originalSecrets = { KEY: "original" };
    const sandbox = new Sandbox(
      [
        {
          name: "mutate_secrets",
          handler:
            'async (args, ctx) => { ctx.secrets.KEY = "mutated"; return ctx.secrets.KEY; }',
        },
        {
          name: "read_secret",
          handler: "async (args, ctx) => ctx.secrets.KEY",
        },
      ],
      originalSecrets
    );

    // First call mutates ctx.secrets
    await sandbox.execute("mutate_secrets", {});
    // Second call should get fresh copy
    const result = await sandbox.execute("read_secret", {});
    expect(result).toBe("original");
    sandbox.dispose();
  });

  it("returns error for unknown tool", async () => {
    const sandbox = new Sandbox([], {});
    const result = await sandbox.execute("nonexistent", {});
    expect(result).toContain('Unknown tool "nonexistent"');
    sandbox.dispose();
  });

  it("handles handler errors gracefully", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "fail",
          handler: 'async () => { throw new Error("boom"); }',
        },
      ],
      {}
    );

    const result = await sandbox.execute("fail", {});
    expect(result).toContain("Error:");
    expect(result).toContain("boom");
    sandbox.dispose();
  });

  it("injects ctx.fetch", async () => {
    // Mock global fetch for this test
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ temp: 72 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const sandbox = new Sandbox(
      [
        {
          name: "call_api",
          handler:
            'async (args, ctx) => { const resp = await ctx.fetch("https://api.example.com/data"); return await resp.json(); }',
        },
      ],
      {}
    );

    const result = await sandbox.execute("call_api", {});
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ temp: 72 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    sandbox.dispose();
    vi.restoreAllMocks();
  });

  it("can execute multiple tools in the same sandbox", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "add",
          handler: "async (args) => args.a + args.b",
        },
        {
          name: "multiply",
          handler: "async (args) => args.a * args.b",
        },
      ],
      {}
    );

    const addResult = await sandbox.execute("add", { a: 3, b: 4 });
    expect(addResult).toBe("7");

    const mulResult = await sandbox.execute("multiply", { a: 3, b: 4 });
    expect(mulResult).toBe("12");

    sandbox.dispose();
  });

  it("handles handler returning null", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "noop",
          handler: "async () => null",
        },
      ],
      {}
    );

    const result = await sandbox.execute("noop", {});
    expect(result).toBe("null");
    sandbox.dispose();
  });

  it("handles handler returning array", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "list",
          handler: "async () => [1, 2, 3]",
        },
      ],
      {}
    );

    const result = await sandbox.execute("list", {});
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
    sandbox.dispose();
  });

  it("dispose can be called multiple times safely", () => {
    const sandbox = new Sandbox([], {});
    sandbox.dispose();
    sandbox.dispose(); // Should not throw
  });
});
