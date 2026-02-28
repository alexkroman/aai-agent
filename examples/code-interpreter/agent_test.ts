import { assertEquals } from "@std/assert";
import agent from "./agent.ts";

Deno.test("code-interpreter - has correct config", () => {
  assertEquals(agent.name, "Coda");
  assertEquals(agent.voice, "dan");
  assertEquals("run_code" in agent.tools, true);
});

Deno.test("code-interpreter - evaluates a return expression", async () => {
  const handler = agent.tools.run_code.handler;
  const ctx = { secrets: {}, fetch: globalThis.fetch };
  const result = await handler({ code: "return 2 + 3" }, ctx);
  assertEquals(result, "5");
});

Deno.test("code-interpreter - captures print output", async () => {
  const handler = agent.tools.run_code.handler;
  const ctx = { secrets: {}, fetch: globalThis.fetch };
  const result = await handler(
    { code: 'print("hello"); print("world"); return 42' },
    ctx,
  );
  assertEquals(result, { output: "hello\nworld", result: "42" });
});

Deno.test("code-interpreter - returns error on bad code", async () => {
  const handler = agent.tools.run_code.handler;
  const ctx = { secrets: {}, fetch: globalThis.fetch };
  const result = await handler({ code: "throw new Error('boom')" }, ctx);
  assertEquals(result, { error: "boom", output: undefined });
});

Deno.test("code-interpreter - handles no output", async () => {
  const handler = agent.tools.run_code.handler;
  const ctx = { secrets: {}, fetch: globalThis.fetch };
  const result = await handler({ code: "const x = 1" }, ctx);
  assertEquals(result, "Code ran successfully (no output)");
});
