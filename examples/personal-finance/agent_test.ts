import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

Deno.test("personal-finance - has correct config", () => {
  assertEquals(agent.name, "Penny");
  assertEquals(agent.voice, "jess");
  assertEquals(agent.builtinTools, ["run_code", "fetch_json"]);
  assertEquals(Object.keys(agent.tools).length, 0);
});
