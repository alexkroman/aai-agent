import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { agent } from "../agent.ts";

describe("night-owl agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Night Owl");
    expect(agent.config.voice).toBe("dan");
    expect(agent.tools.size).toBe(2);
  });

  describe("sleep_calculator", () => {
    const handler = agent.tools.get("sleep_calculator")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates bedtime for 5 cycles waking at 7:00", async () => {
      const result = (await handler(
        { wake_hour: 7, wake_minute: 0, cycles: 5 },
        ctx,
      )) as Record<string, unknown>;
      // 5 cycles = 450 min + 15 min = 465 min = 7h45m before 07:00 → 23:15
      expect(result.bedtime).toBe("23:15");
      expect(result.sleep_hours).toBe(7.5);
      expect(result.cycles).toBe(5);
    });

    it("wraps past midnight correctly", async () => {
      const result = (await handler(
        { wake_hour: 5, wake_minute: 30, cycles: 6 },
        ctx,
      )) as Record<string, unknown>;
      // 6 cycles = 540 min + 15 min = 555 min = 9h15m before 05:30 → 20:15
      expect(result.bedtime).toBe("20:15");
      expect(result.sleep_hours).toBe(9);
    });

    it("clamps cycles to valid range", async () => {
      const result = (await handler(
        { wake_hour: 8, wake_minute: 0, cycles: 20 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.cycles).toBe(8); // max 8
    });
  });

  describe("recommend", () => {
    const handler = agent.tools.get("recommend")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("returns movie picks for a mood", async () => {
      const result = (await handler(
        { category: "movie", mood: "spooky" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.category).toBe("movie");
      expect(result.mood).toBe("spooky");
      expect(Array.isArray(result.picks)).toBe(true);
      expect((result.picks as string[]).length).toBe(3);
    });

    it("returns music picks", async () => {
      const result = (await handler(
        { category: "music", mood: "chill" },
        ctx,
      )) as Record<string, unknown>;
      expect((result.picks as string[])[0]).toContain("Khruangbin");
    });

    it("returns book picks", async () => {
      const result = (await handler(
        { category: "book", mood: "funny" },
        ctx,
      )) as Record<string, unknown>;
      expect((result.picks as string[])[0]).toContain("Good Omens");
    });
  });
});
