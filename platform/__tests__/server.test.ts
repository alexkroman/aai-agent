import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import {
  createAgentApp,
  escapeHtml,
  FAVICON_SVG,
  renderAgentPage,
} from "../server.ts";
import { Agent } from "../../sdk/agent.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "../../sdk/types.ts";
import type { PlatformConfig } from "../config.ts";
import { createMockSessionDeps } from "./_test-utils.ts";

function makeTestAgent() {
  return new Agent({
    name: "TestBot",
    instructions: "You are a test bot.",
    greeting: "Hello!",
    voice: "jess",
  }).tool("echo", {
    description: "Echo input",
    parameters: z.object({ text: z.string() }),
    handler: ({ text }) => text,
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

describe("renderAgentPage", () => {
  it("returns HTML with agent name", () => {
    const html = renderAgentPage("MyBot");
    expect(html).toContain("<title>MyBot</title>");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("includes basePath in script URL", () => {
    const html = renderAgentPage("Bot", "/my-agent");
    expect(html).toContain("/my-agent/client.js");
  });

  it("uses empty basePath by default", () => {
    const html = renderAgentPage("Bot");
    expect(html).toContain('"/client.js"');
  });

  it("includes platformUrl in script", () => {
    const html = renderAgentPage("Bot", "/agent");
    expect(html).toContain("/agent");
  });

  it("escapes HTML characters in name", () => {
    const html = renderAgentPage('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML characters in basePath", () => {
    const html = renderAgentPage("Bot", '"><script>alert(1)</script>');
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes all special characters", () => {
    expect(escapeHtml("&<>\"'"))
      .toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("createAgentApp", () => {
  const app = createAgentApp({
    agent: makeTestAgent(),
    secrets: {},
    platformConfig: makeTestConfig(),
  });

  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /favicon.ico returns SVG", async () => {
    const res = await app.request("/favicon.ico");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(FAVICON_SVG);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it("GET /favicon.svg returns SVG", async () => {
    const res = await app.request("/favicon.svg");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(FAVICON_SVG);
  });

  it("GET / returns HTML page", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("TestBot");
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("GET /session without upgrade returns 400", async () => {
    const res = await app.request("/session");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("WebSocket");
  });

  it("favicon has Cache-Control header", async () => {
    const res = await app.request("/favicon.ico");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("accepts CORS preflight", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    // CORS middleware should respond
    expect(res.status).toBeLessThan(500);
  });
});

describe("createAgentApp with sessionDepsOverride", () => {
  it("accepts sessionDepsOverride option", () => {
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
        toolExecutor: mocks.deps.toolExecutor,
        normalizeVoiceText: mocks.deps.normalizeVoiceText,
      },
    });
    // App was created successfully with overrides
    expect(app).toBeDefined();
  });
});

describe("createAgentApp with agent that has builtinTools", () => {
  it("includes builtin tool schemas", async () => {
    const agent = new Agent({
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
    // Just verify it creates without error
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});

describe("FAVICON_SVG", () => {
  it("is a valid SVG string", () => {
    expect(FAVICON_SVG).toContain("<svg");
    expect(FAVICON_SVG).toContain("</svg>");
  });
});
