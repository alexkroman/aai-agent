import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { testCtx } from "../../server/_tool_test_utils.ts";
import agent, { convertTemp, evaluate } from "./agent.ts";

// --- evaluate() ---

Deno.test("evaluate - basic arithmetic", () => {
  assertEquals(evaluate("2 + 3"), 5);
  assertEquals(evaluate("10 - 4"), 6);
  assertEquals(evaluate("3 * 7"), 21);
  assertEquals(evaluate("20 / 4"), 5);
  assertEquals(evaluate("10 % 3"), 1);
});

Deno.test("evaluate - operator precedence", () => {
  assertEquals(evaluate("2 + 3 * 4"), 14);
  assertEquals(evaluate("(2 + 3) * 4"), 20);
  assertEquals(evaluate("2 * 3 + 4 * 5"), 26);
  assertEquals(evaluate("10 - 2 * 3"), 4);
});

Deno.test("evaluate - exponentiation is right-associative", () => {
  assertEquals(evaluate("2 ** 3"), 8);
  assertEquals(evaluate("2 ** 3 ** 2"), 512); // 2^(3^2), not (2^3)^2
});

Deno.test("evaluate - unary minus", () => {
  assertEquals(evaluate("-5"), -5);
  assertEquals(evaluate("-5 + 3"), -2);
  assertEquals(evaluate("-(3 + 2)"), -5);
  assertEquals(evaluate("2 * -3"), -6);
});

Deno.test("evaluate - nested parentheses", () => {
  assertEquals(evaluate("((2 + 3) * (4 - 1))"), 15);
  assertEquals(evaluate("(((1 + 1)))"), 2);
});

Deno.test("evaluate - decimals and scientific notation", () => {
  assertEquals(evaluate("1.5 + 2.5"), 4);
  assertEquals(evaluate("1e3"), 1000);
  assertEquals(evaluate("1.5e2"), 150);
  assertAlmostEquals(evaluate("2E-1"), 0.2, 1e-10);
});

Deno.test("evaluate - math functions", () => {
  assertEquals(evaluate("sqrt(144)"), 12);
  assertEquals(evaluate("abs(-42)"), 42);
  assertEquals(evaluate("floor(3.7)"), 3);
  assertEquals(evaluate("ceil(3.2)"), 4);
  assertEquals(evaluate("round(3.5)"), 4);
  assertAlmostEquals(evaluate("sin(0)"), 0, 1e-10);
  assertAlmostEquals(evaluate("cos(0)"), 1, 1e-10);
  assertAlmostEquals(evaluate("log(E)"), 1, 1e-10);
});

Deno.test("evaluate - Math.* prefix syntax", () => {
  assertEquals(evaluate("Math.sqrt(9)"), 3);
  assertEquals(evaluate("Math.abs(-1)"), 1);
  assertEquals(evaluate("Math.floor(2.9)"), 2);
});

Deno.test("evaluate - constants", () => {
  assertEquals(evaluate("PI"), Math.PI);
  assertEquals(evaluate("E"), Math.E);
  assertAlmostEquals(evaluate("2 * PI"), 2 * Math.PI, 1e-10);
});

Deno.test("evaluate - functions composed in expressions", () => {
  assertEquals(evaluate("sqrt(16) + 1"), 5);
  assertEquals(evaluate("2 * sqrt(9)"), 6);
  assertEquals(evaluate("sqrt(3 + 1)"), 2);
});

Deno.test("evaluate - whitespace is ignored", () => {
  assertEquals(evaluate("  2  +  3  "), 5);
  assertEquals(evaluate("2+3"), 5);
});

Deno.test("evaluate - errors on malformed input", () => {
  assertThrows(() => evaluate(""), Error);
  assertThrows(() => evaluate("2 +"), Error);
  assertThrows(() => evaluate("(2 + 3"), Error);
  assertThrows(() => evaluate("foo(1)"), Error);
});

Deno.test("evaluate - rejects code injection", () => {
  assertThrows(() => evaluate("process.exit()"));
  assertThrows(() => evaluate("require('fs')"));
  assertThrows(() => evaluate("globalThis"));
  assertThrows(() => evaluate("eval('1')"));
  assertThrows(() => evaluate("constructor"));
});

// --- convertTemp() ---

Deno.test("convertTemp - C to F", () => {
  assertEquals(convertTemp(0, "C", "F"), 32);
  assertEquals(convertTemp(100, "C", "F"), 212);
});

Deno.test("convertTemp - F to C", () => {
  assertEquals(convertTemp(32, "F", "C"), 0);
  assertEquals(convertTemp(212, "F", "C"), 100);
});

Deno.test("convertTemp - Kelvin roundtrip", () => {
  assertEquals(convertTemp(0, "C", "K"), 273.15);
  assertEquals(convertTemp(273.15, "K", "C"), 0);
});

Deno.test("convertTemp - same unit is identity", () => {
  assertEquals(convertTemp(42, "C", "C"), 42);
  assertEquals(convertTemp(98.6, "F", "F"), 98.6);
});

// --- tool handlers via agent ---

const ctx = testCtx();

Deno.test("calculate handler - valid expression", () => {
  const result = agent.tools.calculate.handler(
    { expression: "(12 + 8) * 3" },
    ctx,
  );
  assertEquals(result, { expression: "(12 + 8) * 3", result: 60 });
});

Deno.test("calculate handler - returns error object for bad input", () => {
  const result = agent.tools.calculate.handler(
    { expression: "process.exit(1)" },
    ctx,
  ) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("calculate handler - returns error for Infinity", () => {
  const result = agent.tools.calculate.handler({ expression: "1 / 0" }, ctx);
  assertEquals(result, { error: "Result is not a finite number" });
});

Deno.test("convert_units handler - km to miles", () => {
  const result = agent.tools.convert_units.handler(
    { value: 10, from: "km", to: "mi" },
    ctx,
  ) as { result: number };
  assertAlmostEquals(result.result, 6.214, 0.01);
});

Deno.test("convert_units handler - kg to lb", () => {
  const result = agent.tools.convert_units.handler(
    { value: 1, from: "kg", to: "lb" },
    ctx,
  ) as { result: number };
  assertAlmostEquals(result.result, 2.205, 0.01);
});

Deno.test("convert_units handler - temperature", () => {
  const result = agent.tools.convert_units.handler(
    { value: 212, from: "F", to: "C" },
    ctx,
  );
  assertEquals(result, { value: 212, from: "F", to: "C", result: 100 });
});

Deno.test("convert_units handler - unknown unit", () => {
  const result = agent.tools.convert_units.handler(
    { value: 1, from: "parsec", to: "mi" },
    ctx,
  );
  assertEquals(result, { error: "Unknown unit: parsec" });
});

Deno.test("roll_dice handler - shape and bounds", () => {
  const result = agent.tools.roll_dice.handler({ count: 4, sides: 6 }, ctx) as {
    dice: string;
    rolls: number[];
    total: number;
  };
  assertEquals(result.dice, "4d6");
  assertEquals(result.rolls.length, 4);
  assertEquals(result.total, result.rolls.reduce((a, b) => a + b, 0));
  for (const r of result.rolls) {
    assertEquals(r >= 1 && r <= 6, true);
  }
});

Deno.test("random_number handler - exact range", () => {
  const result = agent.tools.random_number.handler({ min: 5, max: 5 }, ctx);
  assertEquals(result, { min: 5, max: 5, result: 5 });
});

Deno.test("random_number handler - min > max returns error", () => {
  const result = agent.tools.random_number.handler({ min: 10, max: 1 }, ctx);
  assertEquals(result, { error: "min must be ≤ max" });
});

// --- agent definition ---

Deno.test("agent metadata", () => {
  assertEquals(agent.name, "Math Buddy");
  assertEquals(agent.voice, "jess");
  assertEquals(
    Object.keys(agent.tools).sort(),
    ["calculate", "convert_units", "random_number", "roll_dice"],
  );
});
