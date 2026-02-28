import { assert, assertEquals } from "@std/assert";
import agent from "./agent.ts";

const ctx = { secrets: {}, fetch: globalThis.fetch };

Deno.test("night-owl - has correct config", () => {
  assertEquals(agent.name, "Night Owl");
  assertEquals(agent.voice, "dan");
  assertEquals(Object.keys(agent.tools).length, 2);
});

Deno.test("night-owl - sleep_calculator 5 cycles at 7:00", async () => {
  const result = (await agent.tools.sleep_calculator.handler(
    { wake_hour: 7, wake_minute: 0, cycles: 5 },
    ctx,
  )) as Record<string, unknown>;
  // 5 cycles = 450 min + 15 min = 465 min = 7h45m before 07:00 → 23:15
  assertEquals(result.bedtime, "23:15");
  assertEquals(result.sleep_hours, 7.5);
  assertEquals(result.cycles, 5);
});

Deno.test("night-owl - sleep_calculator wraps past midnight", async () => {
  const result = (await agent.tools.sleep_calculator.handler(
    { wake_hour: 5, wake_minute: 30, cycles: 6 },
    ctx,
  )) as Record<string, unknown>;
  // 6 cycles = 540 min + 15 min = 555 min = 9h15m before 05:30 → 20:15
  assertEquals(result.bedtime, "20:15");
  assertEquals(result.sleep_hours, 9);
});

Deno.test("night-owl - sleep_calculator clamps cycles", async () => {
  const result = (await agent.tools.sleep_calculator.handler(
    { wake_hour: 8, wake_minute: 0, cycles: 20 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.cycles, 8); // max 8
});

Deno.test("night-owl - recommend movie picks", async () => {
  const result = (await agent.tools.recommend.handler(
    { category: "movie", mood: "spooky" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.category, "movie");
  assertEquals(result.mood, "spooky");
  assert(Array.isArray(result.picks));
  assertEquals((result.picks as string[]).length, 3);
});

Deno.test("night-owl - recommend music picks", async () => {
  const result = (await agent.tools.recommend.handler(
    { category: "music", mood: "chill" },
    ctx,
  )) as Record<string, unknown>;
  assert((result.picks as string[])[0].includes("Khruangbin"));
});

Deno.test("night-owl - recommend book picks", async () => {
  const result = (await agent.tools.recommend.handler(
    { category: "book", mood: "funny" },
    ctx,
  )) as Record<string, unknown>;
  assert((result.picks as string[])[0].includes("Good Omens"));
});
