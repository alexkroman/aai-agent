import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { Agent } from "./agent.ts";
import { tool } from "./tool.ts";
import { FAVICON_SVG } from "./html.ts";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "./agent_types.ts";

function makeTestAgent() {
  return new Agent({
    name: "TestBot",
    instructions: "You are a test bot.",
    greeting: "Hello!",
    voice: "jess",
    tools: {
      echo: tool({
        description: "Echo input",
        parameters: z.object({ text: z.string() }),
        handler: ({ text }) => text,
      }),
    },
  });
}

// ── Constructor defaults ────────────────────────────────────────

Deno.test("Agent - fills defaults", () => {
  const agent = new Agent({ name: "Minimal" });
  assertEquals(agent.name, "Minimal");
  assertEquals(agent.voice, "jess");
  assertEquals(agent.instructions, DEFAULT_INSTRUCTIONS);
  assertEquals(agent.greeting, DEFAULT_GREETING);
  assertEquals(Object.keys(agent.tools).length, 0);
});

Deno.test("Agent - preserves explicit config", () => {
  const agent = new Agent({
    name: "TestAgent",
    instructions: "Custom instructions.",
    greeting: "Hi!",
    voice: "dan",
  });
  assertEquals(agent.name, "TestAgent");
  assertEquals(agent.instructions, "Custom instructions.");
  assertEquals(agent.greeting, "Hi!");
  assertEquals(agent.voice, "dan");
});

Deno.test("Agent - stores optional fields", () => {
  const agent = new Agent({
    name: "Test",
    prompt: "Transcribe accurately",
    builtinTools: ["web_search"],
  });
  assertEquals(agent.prompt, "Transcribe accurately");
  assertEquals(agent.builtinTools, ["web_search"]);
});

Deno.test("Agent - preserves tools and hooks", () => {
  const handler = () => {};
  const agent = new Agent({
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

// ── fetch() routes ──────────────────────────────────────────────

Deno.test("Agent.fetch - GET /health returns ok", async () => {
  const agent = makeTestAgent();
  const res = await agent.fetch(new Request("http://localhost/health"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
});

Deno.test("Agent.fetch - GET / returns HTML with agent name", async () => {
  const agent = makeTestAgent();
  const res = await agent.fetch(new Request("http://localhost/"));
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text.includes("TestBot"));
  assert(text.includes("<!DOCTYPE html>"));
});

Deno.test("Agent.fetch - GET /session without upgrade returns 400", async () => {
  const agent = makeTestAgent();
  const res = await agent.fetch(new Request("http://localhost/session"));
  assertEquals(res.status, 400);
  const text = await res.text();
  assert(text.includes("WebSocket"));
});

Deno.test("Agent.fetch - GET /favicon.ico returns SVG", async () => {
  const agent = makeTestAgent();
  const res = await agent.fetch(new Request("http://localhost/favicon.ico"));
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, FAVICON_SVG);
  assertEquals(res.headers.get("Content-Type"), "image/svg+xml");
});

Deno.test("Agent.fetch - CORS preflight works", async () => {
  const agent = makeTestAgent();
  const res = await agent.fetch(
    new Request("http://localhost/health", {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    }),
  );
  assert(res.status < 500);
});

// ── Properties are accessible ───────────────────────────────────

Deno.test("Agent - tools are accessible for testing", async () => {
  const agent = makeTestAgent();
  const result = await agent.tools.echo.handler(
    { text: "hello" },
    { secrets: {}, fetch: globalThis.fetch },
  );
  assertEquals(result, "hello");
});
