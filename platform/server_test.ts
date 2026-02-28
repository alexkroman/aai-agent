import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { createAgentApp } from "./server.ts";
import { FAVICON_SVG, renderAgentPage } from "./html.ts";
import { defineAgent, tool } from "../sdk/agent.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
import type { PlatformConfig } from "./config.ts";
import { createMockSessionDeps } from "./_test_utils.ts";

function makeTestAgent() {
  return defineAgent({
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

function makeTestConfig(): PlatformConfig {
  return {
    apiKey: "test-key",
    ttsApiKey: "test-tts-key",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" },
    model: "test-model",
    llmGatewayBase: "https://test.example.com/v1",
  };
}

Deno.test("renderAgentPage - returns HTML with agent name", () => {
  const page = renderAgentPage("MyBot").toString();
  assert(page.includes("<title>MyBot</title>"));
  assert(page.includes("<!DOCTYPE html>"));
});

Deno.test("renderAgentPage - includes basePath in script URL", () => {
  const page = renderAgentPage("Bot", "/my-agent").toString();
  assert(page.includes("/my-agent/client.js"));
});

Deno.test("renderAgentPage - uses empty basePath by default", () => {
  const page = renderAgentPage("Bot").toString();
  assert(page.includes('"/client.js"'));
});

Deno.test("renderAgentPage - includes platformUrl in script", () => {
  const page = renderAgentPage("Bot", "/agent").toString();
  assert(page.includes("/agent"));
});

Deno.test("renderAgentPage - escapes HTML characters in name", () => {
  const page = renderAgentPage('<script>alert("xss")</script>').toString();
  assert(!page.includes("<script>alert"));
  assert(page.includes("&lt;script&gt;"));
});

Deno.test("renderAgentPage - escapes HTML characters in basePath", () => {
  const page = renderAgentPage("Bot", '"><script>alert(1)</script>')
    .toString();
  assert(!page.includes('"><script>'));
  assert(page.includes("&quot;&gt;&lt;script&gt;"));
});

Deno.test("createAgentApp - GET /health returns ok", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/health");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
});

Deno.test("createAgentApp - GET /favicon.ico returns SVG", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/favicon.ico");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, FAVICON_SVG);
  assertEquals(res.headers.get("Content-Type"), "image/svg+xml");
});

Deno.test("createAgentApp - GET /favicon.svg returns SVG", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/favicon.svg");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, FAVICON_SVG);
});

Deno.test("createAgentApp - GET / returns HTML page", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/");
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text.includes("TestBot"));
  assert(text.includes("<!DOCTYPE html>"));
});

Deno.test("createAgentApp - GET /session without upgrade returns 400", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/session");
  assertEquals(res.status, 400);
  const text = await res.text();
  assert(text.includes("WebSocket"));
});

Deno.test("createAgentApp - favicon has Cache-Control header", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/favicon.ico");
  assertEquals(res.headers.get("Cache-Control"), "public, max-age=86400");
});

Deno.test("createAgentApp - accepts CORS preflight", async () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/health", {
    method: "OPTIONS",
    headers: { Origin: "http://example.com" },
  });
  assert(res.status < 500);
});

Deno.test("createAgentApp - accepts sessionDepsOverride", () => {
  const mocks = createMockSessionDeps();
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: { MY_KEY: "val" },
    platformConfig: makeTestConfig(),
    sessionDepsOverride: {
      connectStt: mocks.deps.connectStt,
      callLLM: mocks.deps.callLLM,
      // deno-lint-ignore no-explicit-any
      ttsClient: mocks.deps.ttsClient as any,
      executeTool: mocks.deps.executeTool,
    },
  });
  assert(app !== undefined);
});

Deno.test("createAgentApp - with builtinTools", async () => {
  const agent = defineAgent({
    name: "ToolBot",
    instructions: "Test",
    greeting: "Hi",
    voice: "jess",
    builtinTools: ["web_search"],
  });
  const app = createAgentApp({
    agent,
    secrets: {},
    platformConfig: makeTestConfig(),
  });
  const res = await app.request("/health");
  assertEquals(res.status, 200);
});

Deno.test("FAVICON_SVG - is a valid SVG string", () => {
  assert(FAVICON_SVG.includes("<svg"));
  assert(FAVICON_SVG.includes("</svg>"));
});
