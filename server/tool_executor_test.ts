import { assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "zod";
import {
  createToolExecutor,
  executeToolCall,
  toToolHandlers,
} from "./tool_executor.ts";
import { tool } from "./tool.ts";
import type { ToolHandler } from "./agent_types.ts";

function handler(
  schema: z.ZodObject<z.ZodRawShape>,
  fn: ToolHandler["handler"],
): ToolHandler {
  return { schema, handler: fn };
}

Deno.test("executeToolCall - validates and runs handler", async () => {
  const t = handler(
    z.object({ name: z.string() }),
    ({ name }) => `Hi ${name}`,
  );
  assertEquals(
    await executeToolCall("greet", { name: "Deno" }, t, {}),
    "Hi Deno",
  );
});

Deno.test("executeToolCall - returns validation error for bad args", async () => {
  const t = handler(z.object({ name: z.string() }), () => "ok");
  const result = await executeToolCall("greet", { name: 123 }, t, {});
  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "Invalid arguments");
});

Deno.test("executeToolCall - applies zod defaults", async () => {
  const t = handler(
    z.object({ n: z.number().default(5) }),
    ({ n }) => `n=${n}`,
  );
  assertEquals(await executeToolCall("x", {}, t, {}), "n=5");
});

Deno.test("executeToolCall - serializes objects to JSON", async () => {
  const t = handler(z.object({}), () => ({ a: 1 }));
  assertEquals(JSON.parse(await executeToolCall("x", {}, t, {})), { a: 1 });
});

Deno.test("executeToolCall - null/undefined result becomes 'null'", async () => {
  const nullTool = handler(z.object({}), () => null);
  const undefTool = handler(z.object({}), () => undefined);
  assertEquals(await executeToolCall("x", {}, nullTool, {}), "null");
  assertEquals(await executeToolCall("x", {}, undefTool, {}), "null");
});

Deno.test("executeToolCall - catches handler errors", async () => {
  const t = handler(z.object({}), () => {
    throw new Error("boom");
  });
  assertStringIncludes(await executeToolCall("x", {}, t, {}), "boom");
});

Deno.test("executeToolCall - passes secrets and fetch in context", async () => {
  let captured: Record<string, unknown> = {};
  const t = handler(z.object({}), (_args, ctx) => {
    captured = { secrets: ctx.secrets, hasFetch: !!ctx.fetch };
    return "ok";
  });
  await executeToolCall("x", {}, t, { KEY: "val" });
  assertEquals(captured.secrets, { KEY: "val" });
  assertEquals(captured.hasFetch, true);
});

Deno.test("createToolExecutor - dispatches to named tool", async () => {
  const tools = new Map<string, ToolHandler>([
    ["ping", handler(z.object({}), () => "pong")],
  ]);
  assertEquals(await createToolExecutor(tools, {})("ping", {}), "pong");
});

Deno.test("createToolExecutor - returns error for unknown tool", async () => {
  assertStringIncludes(
    await createToolExecutor(new Map(), {})("nope", {}),
    "Unknown tool",
  );
});

Deno.test("toToolHandlers - converts ToolDef record to Map", () => {
  const schema = z.object({ name: z.string() });
  const h = () => "result";
  const tools = {
    greet: tool({ description: "Greet", parameters: schema, handler: h }),
  };

  const handlers = toToolHandlers(tools);
  assertEquals(handlers.size, 1);
  const th = handlers.get("greet")!;
  assertEquals(th.schema, schema);
  assertEquals(th.handler, h);
});

Deno.test("toToolHandlers - empty record gives empty Map", () => {
  assertEquals(toToolHandlers({}).size, 0);
});
