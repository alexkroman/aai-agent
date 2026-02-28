import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { executeTurn, type TurnContext } from "./turn_handler.ts";
import { createMockLLMResponse } from "./_test_utils.ts";
import type { ChatMessage, LLMResponse } from "./types.ts";
import type { CallLLMOptions } from "./llm.ts";
import { getLogger } from "../_utils/logger.ts";

const noopLogger = getLogger("test-turn");

function createCtx(
  overrides?: Partial<TurnContext>,
): TurnContext & {
  llmCalls: CallLLMOptions[];
  builtinCalls: { name: string; args: Record<string, unknown> }[];
  userToolCalls: { name: string; args: Record<string, unknown> }[];
} {
  const llmCalls: CallLLMOptions[] = [];
  const builtinCalls: { name: string; args: Record<string, unknown> }[] = [];
  const userToolCalls: { name: string; args: Record<string, unknown> }[] = [];
  let llmCallIndex = 0;
  const llmResponses: LLMResponse[] = [
    createMockLLMResponse("Hello from LLM"),
  ];

  return {
    messages: [{ role: "system", content: "You are helpful." }],
    toolSchemas: [],
    logger: noopLogger,
    callLLM(opts: CallLLMOptions) {
      llmCalls.push(opts);
      const resp = llmResponses[llmCallIndex] ??
        createMockLLMResponse("Default");
      llmCallIndex++;
      return Promise.resolve(resp);
    },
    executeBuiltinTool(name, args) {
      builtinCalls.push({ name, args });
      return Promise.resolve(null);
    },
    executeUserTool(name, args) {
      userToolCalls.push({ name, args });
      return Promise.resolve('"tool result"');
    },
    apiKey: "test-key",
    model: "test-model",
    llmCalls,
    builtinCalls,
    userToolCalls,
    ...overrides,
  };
}

describe("executeTurn", () => {
  it("pushes user message and returns LLM text", async () => {
    const ctx = createCtx();
    const abort = new AbortController();

    const result = await executeTurn("Hello", ctx, abort.signal);

    expect(result.text).toBe("Hello from LLM");
    expect(result.steps).toEqual([]);
    // user message was pushed
    expect(ctx.messages[1]).toEqual({ role: "user", content: "Hello" });
    // assistant message was pushed
    expect(ctx.messages[2]).toEqual({
      role: "assistant",
      content: "Hello from LLM",
    });
  });

  it("passes apiKey, model, gatewayBase, and signal to callLLM", async () => {
    const ctx = createCtx({ gatewayBase: "https://gw.test/v1" });
    const abort = new AbortController();

    await executeTurn("Hi", ctx, abort.signal);

    expect(ctx.llmCalls.length).toBe(1);
    expect(ctx.llmCalls[0].apiKey).toBe("test-key");
    expect(ctx.llmCalls[0].model).toBe("test-model");
    expect(ctx.llmCalls[0].gatewayBase).toBe("https://gw.test/v1");
    expect(ctx.llmCalls[0].signal).toBe(abort.signal);
  });

  it("returns fallback text when LLM content is null", async () => {
    const ctx = createCtx({
      callLLM: () => Promise.resolve(createMockLLMResponse(null)),
    });

    const result = await executeTurn("Hi", ctx, new AbortController().signal);

    expect(result.text).toBe("Sorry, I couldn't generate a response.");
  });

  it("returns empty text when choices array is empty", async () => {
    const ctx = createCtx({
      callLLM: () => Promise.resolve({ choices: [] }),
    });

    const result = await executeTurn("Hi", ctx, new AbortController().signal);

    expect(result.text).toBe("");
    expect(result.steps).toEqual([]);
  });

  describe("tool calls", () => {
    it("executes tool and re-calls LLM with results", async () => {
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "get_weather", arguments: '{"city":"NYC"}' },
      ]);
      const finalResp = createMockLLMResponse("Sunny in NYC.");

      let idx = 0;
      const ctx = createCtx({
        callLLM: () => {
          const r = [toolResp, finalResp][idx++] ?? finalResp;
          return Promise.resolve(r);
        },
      });

      const result = await executeTurn(
        "Weather?",
        ctx,
        new AbortController().signal,
      );

      expect(result.text).toBe("Sunny in NYC.");
      expect(result.steps).toEqual(["Using get_weather"]);
      expect(ctx.userToolCalls.length).toBe(1);
      expect(ctx.userToolCalls[0]).toEqual({
        name: "get_weather",
        args: { city: "NYC" },
      });

      // Messages: system, user, assistant (tool_calls), tool, assistant (final)
      expect(ctx.messages.length).toBe(5);
      expect(ctx.messages[3].role).toBe("tool");
      expect(ctx.messages[3].content).toBe('"tool result"');
    });

    it("uses builtin tool result when available", async () => {
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "builtin_tool", arguments: '{"x":1}' },
      ]);
      const finalResp = createMockLLMResponse("Done.");

      let idx = 0;
      const ctx = createCtx({
        callLLM: () => {
          const r = [toolResp, finalResp][idx++] ?? finalResp;
          return Promise.resolve(r);
        },
        executeBuiltinTool: (name, args) => {
          ctx.builtinCalls.push({ name, args });
          return Promise.resolve("builtin result");
        },
      });

      const result = await executeTurn(
        "Do it",
        ctx,
        new AbortController().signal,
      );

      expect(result.text).toBe("Done.");
      expect(ctx.builtinCalls.length).toBe(1);
      // User tool should NOT be called since builtin returned a result
      expect(ctx.userToolCalls.length).toBe(0);
      expect(ctx.messages[3].content).toBe("builtin result");
    });

    it("handles invalid JSON tool arguments gracefully", async () => {
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "bad_tool", arguments: "not json" },
      ]);
      const finalResp = createMockLLMResponse("Recovered.");

      let idx = 0;
      const ctx = createCtx({
        callLLM: () => {
          const r = [toolResp, finalResp][idx++] ?? finalResp;
          return Promise.resolve(r);
        },
      });

      const result = await executeTurn(
        "Test",
        ctx,
        new AbortController().signal,
      );

      expect(result.text).toBe("Recovered.");
      // tool result message should contain the error
      const toolMsg = ctx.messages.find(
        (m) => m.role === "tool" && m.content?.includes("Invalid JSON"),
      );
      expect(toolMsg).toBeDefined();
    });

    it("handles rejected tool execution", async () => {
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "failing", arguments: "{}" },
      ]);
      const finalResp = createMockLLMResponse("Handled.");

      let idx = 0;
      const ctx = createCtx({
        callLLM: () => {
          const r = [toolResp, finalResp][idx++] ?? finalResp;
          return Promise.resolve(r);
        },
        executeUserTool: () => Promise.reject(new Error("tool boom")),
      });

      const result = await executeTurn(
        "Go",
        ctx,
        new AbortController().signal,
      );

      expect(result.text).toBe("Handled.");
      const toolMsg = ctx.messages.find(
        (m) => m.role === "tool" && m.content?.includes("Error:"),
      );
      expect(toolMsg).toBeDefined();
    });

    it("executes multiple tool calls in parallel", async () => {
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "tool_a", arguments: '{"a":1}' },
        { id: "c2", name: "tool_b", arguments: '{"b":2}' },
      ]);
      const finalResp = createMockLLMResponse("Both done.");

      let idx = 0;
      const ctx = createCtx({
        callLLM: () => {
          const r = [toolResp, finalResp][idx++] ?? finalResp;
          return Promise.resolve(r);
        },
      });

      const result = await executeTurn(
        "Go",
        ctx,
        new AbortController().signal,
      );

      expect(result.text).toBe("Both done.");
      expect(result.steps).toEqual(["Using tool_a", "Using tool_b"]);
      expect(ctx.userToolCalls.length).toBe(2);
      // Two tool result messages
      const toolMsgs = ctx.messages.filter((m) => m.role === "tool");
      expect(toolMsgs.length).toBe(2);
      expect(toolMsgs[0].tool_call_id).toBe("c1");
      expect(toolMsgs[1].tool_call_id).toBe("c2");
    });

    it("stops after MAX_TOOL_ITERATIONS without final text", async () => {
      // Every LLM call returns tool calls — never a text response
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "loop_tool", arguments: "{}" },
      ]);

      const ctx = createCtx({
        callLLM: () => Promise.resolve(toolResp),
      });

      const result = await executeTurn(
        "Go",
        ctx,
        new AbortController().signal,
      );

      // Should exhaust iterations and return empty
      expect(result.text).toBe("");
      // One tool execution per loop iteration
      expect(ctx.builtinCalls.length).toBe(3);
    });
  });

  describe("abort signal", () => {
    it("stops tool loop when signal is aborted mid-iteration", async () => {
      const abort = new AbortController();
      const toolResp = createMockLLMResponse(null, [
        { id: "c1", name: "slow", arguments: "{}" },
      ]);

      const ctx = createCtx({
        callLLM: () => Promise.resolve(toolResp),
        executeUserTool: () => {
          // Abort during tool execution
          abort.abort();
          return Promise.resolve("done");
        },
      });

      const result = await executeTurn("Go", ctx, abort.signal);

      // Should return empty since we aborted before re-calling LLM
      expect(result.text).toBe("");
    });
  });

  it("mutates the messages array in-place", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "System prompt" },
    ];
    const ctx = createCtx({ messages });

    await executeTurn("Hi", ctx, new AbortController().signal);

    // The original array should have been mutated
    expect(messages.length).toBe(3);
    expect(messages[1].role).toBe("user");
    expect(messages[2].role).toBe("assistant");
  });
});
