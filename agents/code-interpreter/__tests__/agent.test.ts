import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { agent } from "../agent.ts";

describe("code-interpreter agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Coda");
    expect(agent.config.voice).toBe("dan");
    expect(agent.tools.has("run_code")).toBe(true);
  });

  describe("run_code", () => {
    const handler = agent.tools.get("run_code")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("evaluates a return expression", async () => {
      const result = await handler({ code: "return 2 + 3" }, ctx);
      expect(result).toBe("5");
    });

    it("captures print output", async () => {
      const result = await handler(
        { code: 'print("hello"); print("world"); return 42' },
        ctx,
      );
      expect(result).toEqual({ output: "hello\nworld", result: "42" });
    });

    it("returns error on bad code", async () => {
      const result = await handler({ code: "throw new Error('boom')" }, ctx);
      expect(result).toEqual({ error: "boom", output: undefined });
    });

    it("handles no output", async () => {
      const result = await handler({ code: "const x = 1" }, ctx);
      expect(result).toBe("Code ran successfully (no output)");
    });
  });
});
