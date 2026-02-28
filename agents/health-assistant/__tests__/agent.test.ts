import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import agent from "../agent.ts";

describe("health-assistant agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Dr. Sage");
    expect(agent.config.voice).toBe("tara");
    expect(agent.tools.size).toBe(5);
  });

  describe("calculate_bmi", () => {
    const handler = agent.tools.get("calculate_bmi")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates normal BMI", async () => {
      const result = (await handler(
        { weight: 70, weight_unit: "kg", height: 175, height_unit: "cm" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.category).toBe("normal");
      expect(result.bmi).toBeCloseTo(22.9, 0);
    });

    it("converts pounds and feet", async () => {
      const result = (await handler(
        { weight: 150, weight_unit: "lb", height: 5.5, height_unit: "ft" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.weight_kg).toBeCloseTo(68, 0);
      expect(typeof result.bmi).toBe("number");
    });
  });

  describe("dosage_by_weight", () => {
    const handler = agent.tools.get("dosage_by_weight")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates mg dosage from kg", async () => {
      const result = (await handler(
        {
          medication: "ibuprofen",
          weight: 30,
          weight_unit: "kg",
          dose_per_kg: 10,
        },
        ctx,
      )) as Record<string, unknown>;
      expect(result.calculated_dose_mg).toBe(300);
    });
  });
});
