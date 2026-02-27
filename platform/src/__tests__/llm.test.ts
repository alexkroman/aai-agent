import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callLLM } from "../llm.js";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callLLM", () => {
  it("sends correct request format without tools", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "cmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
      }),
    });

    const result = await callLLM(
      [{ role: "user", content: "Hi" }],
      [],
      "test-key",
      "test-model",
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
    expect(body.tools).toBeUndefined();

    expect(result.choices[0].message.content).toBe("Hello!");
  });

  it("sends tools in OpenAI format when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { role: "assistant", content: "Let me check." },
            finish_reason: "stop",
          },
        ],
      }),
    });

    await callLLM(
      [{ role: "user", content: "Hi" }],
      [
        {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      ],
      "key",
      "model",
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("returns tool_calls from the response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "tc-1",
                  type: "function",
                  function: { name: "test", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_use",
          },
        ],
      }),
    });

    const result = await callLLM([], [], "key", "model");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe("test");
  });

  it("sanitizes empty text content to placeholder", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
      }),
    });

    await callLLM(
      [
        { role: "user", content: "" },
        { role: "user", content: "   " },
        { role: "user", content: "hello" },
      ],
      [],
      "key",
      "model",
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe("...");
    expect(body.messages[1].content).toBe("...");
    expect(body.messages[2].content).toBe("hello");
  });

  it("throws on non-200 responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(callLLM([], [], "bad-key", "model")).rejects.toThrow(
      "LLM request failed: 401",
    );
  });

  it("passes abort signal to fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
      }),
    });

    const controller = new AbortController();
    await callLLM([], [], "key", "model", controller.signal);

    expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
