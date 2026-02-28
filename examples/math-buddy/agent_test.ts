import { assertAlmostEquals, assertEquals } from "@std/assert";
import agent from "./agent.ts";

const ctx = { secrets: {}, fetch: globalThis.fetch };

Deno.test("math-buddy - has correct config", () => {
  assertEquals(agent.name, "Math Buddy");
  assertEquals(agent.voice, "jess");
  assertEquals(Object.keys(agent.tools).length, 4);
});

Deno.test("math-buddy - calculate evaluates simple expression", async () => {
  const result = await agent.tools.calculate.handler(
    { expression: "(12 + 8) * 3" },
    ctx,
  );
  assertEquals(result, { expression: "(12 + 8) * 3", result: 60 });
});

Deno.test("math-buddy - calculate rejects invalid characters", async () => {
  const result = await agent.tools.calculate.handler(
    { expression: "process.exit(1)" },
    ctx,
  );
  assertEquals(result, { error: "Expression contains invalid characters" });
});

Deno.test("math-buddy - convert_units km to miles", async () => {
  const result = (await agent.tools.convert_units.handler(
    { value: 10, from: "km", to: "mi" },
    ctx,
  )) as Record<string, unknown>;
  assertAlmostEquals(result.result as number, 6.214, 0.01);
});

Deno.test("math-buddy - convert_units F to C", async () => {
  const result = (await agent.tools.convert_units.handler(
    { value: 212, from: "F", to: "C" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.result, 100);
});

Deno.test("math-buddy - random_number generates in range", async () => {
  const result = (await agent.tools.random_number.handler(
    { min: 5, max: 5 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.result, 5);
});

Deno.test("math-buddy - random_number error when min > max", async () => {
  const result = (await agent.tools.random_number.handler(
    { min: 10, max: 5 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(typeof result.error, "string");
});
