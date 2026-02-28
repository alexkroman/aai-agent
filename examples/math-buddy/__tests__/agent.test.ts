import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { agent } from "../agent.ts";

describe("math-buddy agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Math Buddy");
    expect(agent.config.voice).toBe("jess");
    expect(agent.tools.size).toBe(4);
  });

  describe("calculate", () => {
    const handler = agent.tools.get("calculate")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("evaluates simple expression", async () => {
      const result = await handler({ expression: "(12 + 8) * 3" }, ctx);
      expect(result).toEqual({ expression: "(12 + 8) * 3", result: 60 });
    });

    it("rejects invalid characters", async () => {
      const result = await handler({ expression: "process.exit(1)" }, ctx);
      expect(result).toEqual({
        error: "Expression contains invalid characters",
      });
    });
  });

  describe("convert_units", () => {
    const handler = agent.tools.get("convert_units")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("converts km to miles", async () => {
      const result = (await handler(
        { value: 10, from: "km", to: "mi" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.result).toBeCloseTo(6.214, 2);
    });

    it("converts temperature F to C", async () => {
      const result = (await handler(
        { value: 212, from: "F", to: "C" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.result).toBe(100);
    });
  });

  describe("random_number", () => {
    const handler = agent.tools.get("random_number")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("generates number in range", async () => {
      const result = (await handler(
        { min: 5, max: 5 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.result).toBe(5);
    });

    it("returns error when min > max", async () => {
      const result = (await handler(
        { min: 10, max: 5 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.error).toBeDefined();
    });
  });
});
