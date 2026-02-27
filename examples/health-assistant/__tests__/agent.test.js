import { describe, test, expect } from "vitest";
import { capturedConfig } from "../../__tests__/_mock-client.js";

await import("../agent.js");
const { calculate_bmi, dosage_by_weight } = capturedConfig.tools;

describe("health-assistant — calculate_bmi", () => {
  test("normal BMI in metric units", async () => {
    const result = await calculate_bmi.handler({
      weight: 70,
      weight_unit: "kg",
      height: 175,
      height_unit: "cm",
    });
    expect(result.bmi).toBe(22.9);
    expect(result.category).toBe("normal");
    expect(result.weight_kg).toBe(70);
    expect(result.height_m).toBe(1.75);
  });

  test("converts pounds and inches", async () => {
    const result = await calculate_bmi.handler({
      weight: 150,
      weight_unit: "lb",
      height: 70,
      height_unit: "in",
    });
    expect(result.category).toBe("normal");
    expect(result.weight_kg).toBe(68);
    expect(result.height_m).toBe(1.78);
  });

  test("classifies underweight", async () => {
    const result = await calculate_bmi.handler({
      weight: 50,
      weight_unit: "kg",
      height: 180,
      height_unit: "cm",
    });
    expect(result.bmi).toBe(15.4);
    expect(result.category).toBe("underweight");
  });

  test("classifies overweight", async () => {
    const result = await calculate_bmi.handler({
      weight: 85,
      weight_unit: "kg",
      height: 175,
      height_unit: "cm",
    });
    expect(result.category).toBe("overweight");
  });

  test("classifies obese", async () => {
    const result = await calculate_bmi.handler({
      weight: 120,
      weight_unit: "kg",
      height: 170,
      height_unit: "cm",
    });
    expect(result.category).toBe("obese");
  });

  test("handles feet for height", async () => {
    const result = await calculate_bmi.handler({
      weight: 70,
      weight_unit: "kg",
      height: 5.75,
      height_unit: "ft",
    });
    expect(result.height_m).toBe(1.75);
  });

  test("handles meters for height directly", async () => {
    const result = await calculate_bmi.handler({
      weight: 70,
      weight_unit: "kg",
      height: 1.75,
      height_unit: "m",
    });
    expect(result.bmi).toBe(22.9);
  });
});

describe("health-assistant — dosage_by_weight", () => {
  test("calculates dose in kg", async () => {
    const result = await dosage_by_weight.handler({
      medication: "amoxicillin",
      weight: 25,
      weight_unit: "kg",
      dose_per_kg: 15,
    });
    expect(result.calculated_dose_mg).toBe(375);
    expect(result.patient_weight_kg).toBe(25);
    expect(result.frequency).toBe("as directed");
  });

  test("converts pounds to kg", async () => {
    const result = await dosage_by_weight.handler({
      medication: "ibuprofen",
      weight: 110,
      weight_unit: "lb",
      dose_per_kg: 10,
      frequency: "every 6 hours",
    });
    expect(result.patient_weight_kg).toBe(49.9);
    expect(result.calculated_dose_mg).toBe(499);
    expect(result.frequency).toBe("every 6 hours");
  });

  test("includes disclaimer note", async () => {
    const result = await dosage_by_weight.handler({
      medication: "test",
      weight: 10,
      weight_unit: "kg",
      dose_per_kg: 5,
    });
    expect(result.note).toMatch(/verify with a pharmacist/);
  });
});
