import { describe, it, expect, vi, afterEach } from "vitest";
import { Sandbox } from "../sandbox.js";
import { TIMEOUTS, ISOLATE_MEMORY_LIMIT_MB } from "../constants.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sandbox resource limits", () => {
  it("times out after TOOL_HANDLER timeout", async () => {
    const sandbox = new Sandbox(
      [
        {
          name: "slow",
          handler: "async () => { while(true) {} }",
        },
      ],
      {}
    );

    const result = await sandbox.execute("slow", {});
    expect(result).toContain("timed out");
    expect(result).toContain(String(TIMEOUTS.TOOL_HANDLER));
    sandbox.dispose();
  }, 60_000);

  it("TOOL_HANDLER timeout is 30s", () => {
    expect(TIMEOUTS.TOOL_HANDLER).toBe(30_000);
  });

  it("ISOLATE_MEMORY_LIMIT_MB is 128", () => {
    expect(ISOLATE_MEMORY_LIMIT_MB).toBe(128);
  });

  it("ctx.fetch abort signal is connected to timeout controller", async () => {
    // Mock fetch to verify abort signal is passed
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      // The init should contain a signal
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: async () => '{"result":"ok"}',
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const sandbox = new Sandbox(
      [
        {
          name: "fetch_tool",
          handler:
            'async (args, ctx) => { const r = ctx.fetch("https://api.example.com/data"); return r.json(); }',
        },
      ],
      {}
    );

    const result = await sandbox.execute("fetch_tool", {});
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ result: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    sandbox.dispose();
  });
});
