import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { callLLM } from "../llm.ts";
import type { ChatMessage, ToolSchema } from "../../sdk/types.ts";

describe("callLLM", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: { url: string; init: RequestInit } | null = null;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(
    responseBody: unknown,
    status = 200,
  ): void {
    globalThis.fetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      lastRequest = { url, init: init ?? {} };
      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof globalThis.fetch;
  }

  function mockFetchText(text: string, status: number): void {
    globalThis.fetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      lastRequest = { url, init: init ?? {} };
      return Promise.resolve(new Response(text, { status }));
    }) as typeof globalThis.fetch;
  }

  const validResponse = {
    id: "chatcmpl-test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello!" },
        finish_reason: "stop",
      },
    ],
  };

  const messages: ChatMessage[] = [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hi" },
  ];

  it("sends correct request shape", async () => {
    mockFetch(validResponse);
    await callLLM({
      messages,
      tools: [],
      apiKey: "test-key",
      model: "test-model",
    });

    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.url).toContain("/chat/completions");
    const init = lastRequest!.init;
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
  });

  it("sanitizes empty message content to '...'", async () => {
    mockFetch(validResponse);
    const msgs: ChatMessage[] = [
      { role: "user", content: "" },
      { role: "user", content: "   " },
    ];
    await callLLM({ messages: msgs, tools: [], apiKey: "key", model: "model" });

    const body = JSON.parse(lastRequest!.init.body as string);
    expect(body.messages[0].content).toBe("...");
    expect(body.messages[1].content).toBe("...");
  });

  it("includes tools when provided", async () => {
    mockFetch(validResponse);
    const tools: ToolSchema[] = [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
      },
    ];
    await callLLM({ messages, tools, apiKey: "key", model: "model" });

    const body = JSON.parse(lastRequest!.init.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("get_weather");
  });

  it("does not include tools when list is empty", async () => {
    mockFetch(validResponse);
    await callLLM({ messages, tools: [], apiKey: "key", model: "model" });

    const body = JSON.parse(lastRequest!.init.body as string);
    expect(body.tools).toBeUndefined();
  });

  it("parses valid response", async () => {
    mockFetch(validResponse);
    const result = await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
    });
    expect(result.choices[0].message.content).toBe("Hello!");
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  it("throws on non-OK response", async () => {
    mockFetchText("Unauthorized", 401);
    await expect(
      callLLM({ messages, tools: [], apiKey: "key", model: "model" }),
    ).rejects.toThrow(/401/);
  });

  it("throws on invalid response shape", async () => {
    mockFetch({ invalid: true });
    await expect(
      callLLM({ messages, tools: [], apiKey: "key", model: "model" }),
    ).rejects.toThrow(/Invalid LLM response/);
  });

  it("uses custom gateway base URL", async () => {
    mockFetch(validResponse);
    await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      gatewayBase: "https://custom.gateway.com/v1",
    });
    expect(lastRequest!.url).toContain("custom.gateway.com");
  });

  it("uses default gateway when none specified", async () => {
    mockFetch(validResponse);
    await callLLM({ messages, tools: [], apiKey: "key", model: "model" });
    expect(lastRequest!.url).toContain("llm-gateway.assemblyai.com");
  });

  it("uses injectable fetch option instead of globalThis.fetch", async () => {
    let customFetchCalled = false;
    const customFetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      customFetchCalled = true;
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      lastRequest = { url, init: init ?? {} };
      return Promise.resolve(
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof globalThis.fetch;

    // Set globalThis.fetch to something that should NOT be called
    globalThis.fetch = (() => {
      throw new Error("globalThis.fetch should not be called");
    }) as unknown as typeof globalThis.fetch;

    await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: customFetch,
    });

    expect(customFetchCalled).toBe(true);
  });
});
