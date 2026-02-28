import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

const ctx = { secrets: {}, fetch: globalThis.fetch };

Deno.test("code-interpreter - has correct config", () => {
  assertEquals(agent.name, "Coda");
  assertEquals(agent.voice, "dan");
  assertEquals("run_code" in agent.tools, true);
});

Deno.test("code-interpreter - evaluates an expression", async () => {
  const result = await agent.tools.run_code.handler({ code: "console.log(2 + 3)" }, ctx);
  assertEquals(result, "5");
});

Deno.test("code-interpreter - captures multiple logs", async () => {
  const result = await agent.tools.run_code.handler(
    { code: 'console.log("hello"); console.log("world")' },
    ctx,
  );
  assertEquals(result, "hello\nworld");
});

Deno.test("code-interpreter - returns error on bad code", async () => {
  const result = await agent.tools.run_code.handler(
    { code: "throw new Error('boom')" },
    ctx,
  );
  assertEquals(typeof (result as { error: string }).error, "string");
});

Deno.test("code-interpreter - handles no output", async () => {
  const result = await agent.tools.run_code.handler({ code: "const x = 1" }, ctx);
  assertEquals(result, "Code ran successfully (no output)");
});
