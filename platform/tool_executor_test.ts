import { assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "zod";
import { createToolExecutor, executeToolCall } from "./tool_executor.ts";
import type { ToolHandler } from "../sdk/agent.ts";

function handler(
  schema: z.ZodObject<z.ZodRawShape>,
  fn: ToolHandler["handler"],
): ToolHandler {
  return { schema, handler: fn };
}

Deno.test("executeToolCall - validates and runs handler", async () => {
  const tool = handler(
    z.object({ name: z.string() }),
    ({ name }) => `Hi ${name}`,
  );
  const result = await executeToolCall("greet", { name: "Deno" }, tool, {});
  assertEquals(result, "Hi Deno");
});

Deno.test("executeToolCall - returns validation error for bad args", async () => {
  const tool = handler(z.object({ name: z.string() }), () => "ok");
  const result = await executeToolCall("greet", { name: 123 }, tool, {});
  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "Invalid arguments");
});

Deno.test("executeToolCall - applies zod defaults", async () => {
  const tool = handler(
    z.object({ n: z.number().default(5) }),
    ({ n }) => `n=${n}`,
  );
  const result = await executeToolCall("x", {}, tool, {});
  assertEquals(result, "n=5");
});

Deno.test("executeToolCall - serializes objects to JSON", async () => {
  const tool = handler(z.object({}), () => ({ a: 1 }));
  const result = await executeToolCall("x", {}, tool, {});
  assertEquals(JSON.parse(result), { a: 1 });
});

Deno.test("executeToolCall - null result becomes 'null'", async () => {
  const tool = handler(z.object({}), () => null);
  assertEquals(await executeToolCall("x", {}, tool, {}), "null");
});

Deno.test("executeToolCall - undefined result becomes 'null'", async () => {
  const tool = handler(z.object({}), () => undefined);
  assertEquals(await executeToolCall("x", {}, tool, {}), "null");
});

Deno.test("executeToolCall - catches handler errors", async () => {
  const tool = handler(z.object({}), () => {
    throw new Error("boom");
  });
  const result = await executeToolCall("x", {}, tool, {});
  assertStringIncludes(result, "boom");
});

Deno.test("executeToolCall - passes secrets and fetch in context", async () => {
  let captured: Record<string, unknown> = {};
  const tool = handler(z.object({}), (_args, ctx) => {
    captured = { secrets: ctx.secrets, hasFetch: !!ctx.fetch };
    return "ok";
  });
  await executeToolCall("x", {}, tool, { KEY: "val" });
  assertEquals(captured.secrets, { KEY: "val" });
  assertEquals(captured.hasFetch, true);
});

Deno.test("createToolExecutor - dispatches to named tool", async () => {
  const tools = new Map<string, ToolHandler>([
    ["ping", handler(z.object({}), () => "pong")],
  ]);
  const exec = createToolExecutor(tools, {});
  assertEquals(await exec("ping", {}), "pong");
});

Deno.test("createToolExecutor - returns error for unknown tool", async () => {
  const exec = createToolExecutor(new Map(), {});
  assertStringIncludes(await exec("nope", {}), "Unknown tool");
});
