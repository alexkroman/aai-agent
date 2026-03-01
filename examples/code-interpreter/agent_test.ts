import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

Deno.test("code-interpreter - has correct config", () => {
  assertEquals(agent.name, "Coda");
  assertEquals(agent.voice, "dan");
  assertEquals(agent.builtinTools, ["run_code", "final_answer"]);
  assertEquals(Object.keys(agent.tools).length, 0);
});
