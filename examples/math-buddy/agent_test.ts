import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

Deno.test("math-buddy - has correct config", () => {
  assertEquals(agent.name, "Math Buddy");
  assertEquals(agent.voice, "jess");
  assertEquals(agent.builtinTools, ["run_code"]);
  assertEquals(Object.keys(agent.tools).length, 0);
});
