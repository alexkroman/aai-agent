import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

Deno.test("web-researcher - has correct config", () => {
  assertEquals(agent.name, "Scout");
  assertEquals(agent.voice, "tara");
  assertEquals(agent.builtinTools, ["web_search", "visit_webpage"]);
});

Deno.test("web-researcher - has no custom tools", () => {
  assertEquals(Object.keys(agent.tools).length, 0);
});
