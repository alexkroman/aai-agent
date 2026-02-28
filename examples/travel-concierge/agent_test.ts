import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

Deno.test("travel-concierge - has correct config", () => {
  assertEquals(agent.name, "Aria");
  assertEquals(agent.voice, "tara");
  assertEquals(agent.builtinTools, [
    "web_search",
    "visit_webpage",
    "fetch_json",
  ]);
  assertEquals(Object.keys(agent.tools).length, 0);
});
