import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { defineAgent, tool, toToolHandlers } from "./agent.ts";

Deno.test("defineAgent - fills defaults", () => {
  const agent = defineAgent({ name: "Minimal" });
  assertEquals(agent.name, "Minimal");
  assertEquals(agent.voice, "jess");
  assert(agent.instructions.length > 0);
  assert(agent.greeting.length > 0);
});

Deno.test("defineAgent - preserves explicit config", () => {
  const agent = defineAgent({
    name: "TestAgent",
    instructions: "You are a test agent.",
    greeting: "Hello!",
    voice: "dan",
  });
  assertEquals(agent.name, "TestAgent");
  assertEquals(agent.instructions, "You are a test agent.");
  assertEquals(agent.greeting, "Hello!");
  assertEquals(agent.voice, "dan");
});

Deno.test("defineAgent - stores optional fields", () => {
  const agent = defineAgent({
    name: "Test",
    prompt: "Transcribe accurately",
    builtinTools: ["web_search"],
  });
  assertEquals(agent.prompt, "Transcribe accurately");
  assertEquals(agent.builtinTools, ["web_search"]);
});

Deno.test("defineAgent - empty tools by default", () => {
  const agent = defineAgent({ name: "Test" });
  assertEquals(Object.keys(agent.tools).length, 0);
});

Deno.test("defineAgent - preserves tools and hooks", () => {
  const handler = () => {};
  const agent = defineAgent({
    name: "Test",
    tools: {
      greet: tool({
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hello, ${name}!`,
      }),
    },
    onConnect: handler,
  });
  assert("greet" in agent.tools);
  assertEquals(agent.onConnect, handler);
});

Deno.test("defineAgent - result is frozen", () => {
  const agent = defineAgent({ name: "Frozen" });
  assert(Object.isFrozen(agent));
});

Deno.test("tool - identity function preserves definition", () => {
  const schema = z.object({ x: z.number() });
  const handler = () => "ok";
  const def = tool({ description: "Test", parameters: schema, handler });
  assertEquals(def.description, "Test");
  assertEquals(def.parameters, schema);
  assertEquals(def.handler, handler);
});

Deno.test("toToolHandlers - converts tools to Map", () => {
  const schema = z.object({ name: z.string() });
  const handler = () => "result";
  const agent = defineAgent({
    name: "Test",
    tools: {
      greet: tool({ description: "Greet", parameters: schema, handler }),
    },
  });

  const handlers = toToolHandlers(agent.tools);
  assertEquals(handlers.size, 1);
  const th = handlers.get("greet");
  assert(th !== undefined);
  assertEquals(th.schema, schema);
  assertEquals(th.handler, handler);
});

Deno.test("toToolHandlers - empty when no tools", () => {
  const agent = defineAgent({ name: "Test" });
  const handlers = toToolHandlers(agent.tools);
  assertEquals(handlers.size, 0);
});
