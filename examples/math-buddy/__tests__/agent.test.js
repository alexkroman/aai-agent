import { describe, test, expect } from "vitest";
import { capturedConfig } from "../../__tests__/_mock-client.js";

await import("../agent.js");
const { calculate, convert_units, roll_dice, random_number } =
  capturedConfig.tools;

describe("math-buddy — calculate", () => {
  test("evaluates basic arithmetic", async () => {
    const result = await calculate.handler({ expression: "(12 + 8) * 3" });
    expect(result).toEqual({ expression: "(12 + 8) * 3", result: 60 });
  });

  test("evaluates Math functions", async () => {
    const result = await calculate.handler({
      expression: "Math.sqrt(144)",
    });
    expect(result).toEqual({ expression: "Math.sqrt(144)", result: 12 });
  });

  test("rejects invalid characters", async () => {
    const result = await calculate.handler({
      expression: "process.exit(1)",
    });
    expect(result).toEqual({
      error: "Expression contains invalid characters",
    });
  });

  test("rejects Infinity", async () => {
    const result = await calculate.handler({ expression: "1/0" });
    expect(result).toEqual({
      error: "Expression did not produce a valid number",
    });
  });
});

describe("math-buddy — convert_units", () => {
  test("converts km to miles", async () => {
    const result = await convert_units.handler({
      value: 10,
      from: "km",
      to: "mi",
    });
    expect(result.result).toBeCloseTo(6.214, 3);
  });

  test("converts lb to kg", async () => {
    const result = await convert_units.handler({
      value: 100,
      from: "lb",
      to: "kg",
    });
    expect(result.result).toBeCloseTo(45.359, 3);
  });

  test("converts Fahrenheit to Celsius", async () => {
    const result = await convert_units.handler({
      value: 212,
      from: "F",
      to: "C",
    });
    expect(result.result).toBe(100);
  });

  test("converts Celsius to Fahrenheit", async () => {
    const result = await convert_units.handler({
      value: 0,
      from: "C",
      to: "F",
    });
    expect(result.result).toBe(32);
  });

  test("converts Celsius to Kelvin", async () => {
    const result = await convert_units.handler({
      value: 100,
      from: "C",
      to: "K",
    });
    expect(result.result).toBe(373.15);
  });

  test("returns error for unknown unit", async () => {
    const result = await convert_units.handler({
      value: 10,
      from: "km",
      to: "xyz",
    });
    expect(result).toEqual({ error: "Unknown unit: xyz" });
  });
});

describe("math-buddy — roll_dice", () => {
  test("returns correct structure", async () => {
    const result = await roll_dice.handler({ count: 3, sides: 6 });
    expect(result.dice).toBe("3d6");
    expect(result.rolls).toHaveLength(3);
    expect(result.total).toBe(result.rolls.reduce((a, b) => a + b, 0));
    for (const roll of result.rolls) {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
  });

  test("clamps count to 1..100", async () => {
    const result = await roll_dice.handler({ count: 200, sides: 6 });
    expect(result.rolls).toHaveLength(100);
  });

  test("clamps sides minimum to 2", async () => {
    const result = await roll_dice.handler({ count: 1, sides: 0 });
    expect(result.dice).toBe("1d2");
  });

  test("uses defaults when omitted", async () => {
    const result = await roll_dice.handler({});
    expect(result.dice).toBe("1d6");
    expect(result.rolls).toHaveLength(1);
  });
});

describe("math-buddy — random_number", () => {
  test("generates number within range", async () => {
    const result = await random_number.handler({ min: 5, max: 10 });
    expect(result.result).toBeGreaterThanOrEqual(5);
    expect(result.result).toBeLessThanOrEqual(10);
  });

  test("returns error when min > max", async () => {
    const result = await random_number.handler({ min: 10, max: 5 });
    expect(result).toEqual({
      error: "min must be less than or equal to max",
    });
  });

  test("uses defaults when omitted", async () => {
    const result = await random_number.handler({});
    expect(result.min).toBe(1);
    expect(result.max).toBe(100);
    expect(result.result).toBeGreaterThanOrEqual(1);
    expect(result.result).toBeLessThanOrEqual(100);
  });
});
