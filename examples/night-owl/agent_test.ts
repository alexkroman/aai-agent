import { assert, assertEquals } from "@std/assert";
import { testCtx } from "../../server/_tool_test_utils.ts";
import agent from "./agent.ts";

const ctx = testCtx();

Deno.test("night-owl - has correct config", () => {
  assertEquals(agent.name, "Night Owl");
  assertEquals(agent.voice, "dan");
  assertEquals(agent.builtinTools, ["run_code"]);
  assertEquals(Object.keys(agent.tools).length, 1);
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
