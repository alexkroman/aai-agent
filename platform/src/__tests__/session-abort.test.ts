import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceSession } from "../session.js";
import { makeBrowserWs, getJsonMessages } from "./_mocks.js";
import { createTestDeps, DEFAULT_AGENT_CONFIG, llmResponse } from "./_factories.js";

describe("VoiceSession abort edge cases", () => {
  let browserWs: ReturnType<typeof makeBrowserWs>;

  beforeEach(() => {
    browserWs = makeBrowserWs();
    vi.clearAllMocks();
  });

  it("abort during tool execution does not send chat", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();

    // LLM returns a tool call
    mocks.callLLM.mockResolvedValueOnce({
      id: "resp-tc",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc-0",
                type: "function" as const,
                function: { name: "slow_tool", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_use",
        },
      ],
    });

    // Tool execution hangs until abort
    let toolResolve: ((v: string) => void) | null = null;
    mocks.sandbox.execute.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          toolResolve = resolve;
        })
    );

    const config = {
      ...DEFAULT_AGENT_CONFIG,
      tools: [
        {
          name: "slow_tool",
          description: "Slow",
          parameters: {},
          handler: "async () => 'result'",
        },
      ],
    };

    const session = new VoiceSession("sess-1", browserWs as any, config, deps);
    await session.start();
    browserWs.sent.length = 0;

    getSttEvents().onTurn("Do something slow");

    // Wait for turn+thinking to be sent
    await Promise.resolve();
    await Promise.resolve();

    // Cancel while tool is executing
    await session.onCancel();

    // Resolve the tool (should be ignored since aborted)
    toolResolve!("late result");
    await Promise.resolve();
    await Promise.resolve();

    const msgs = getJsonMessages(browserWs);
    expect(msgs.some((m) => m.type === "chat")).toBe(false);
  });

  it("abort during TTS does not send tts_done", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();
    mocks.callLLM.mockResolvedValueOnce(llmResponse("Hello there!"));

    // Make TTS hang until abort
    const makeTtsHang = () =>
      vi.fn(
        (_text: string, _onAudio: any, signal?: AbortSignal) =>
          new Promise<void>((resolve) => {
            if (signal?.aborted) {
              resolve();
              return;
            }
            signal?.addEventListener("abort", () => resolve(), { once: true });
          })
      );

    mocks.ttsClient.synthesize = makeTtsHang();

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();

    // Clear greeting TTS
    mocks.ttsClient.synthesize = makeTtsHang();
    browserWs.sent.length = 0;

    getSttEvents().onTurn("Say something");
    await session.turnPromise;

    // TTS is now in progress, cancel
    await session.onCancel();

    // Let abort propagate
    await new Promise((r) => setTimeout(r, 10));

    const msgs = getJsonMessages(browserWs);
    expect(msgs.some((m) => m.type === "tts_done")).toBe(false);
  });

  it("rapid cancel-then-turn works correctly", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();

    // First LLM call hangs
    mocks.callLLM.mockImplementationOnce(
      (_msgs: any, _tools: any, _key: any, _model: any, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    // Second LLM call resolves
    mocks.callLLM.mockResolvedValueOnce(llmResponse("Second response!"));

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();
    browserWs.sent.length = 0;

    // Start first turn
    getSttEvents().onTurn("First turn");
    await Promise.resolve();

    // Cancel immediately
    await session.onCancel();

    // Start second turn
    getSttEvents().onTurn("Second turn");
    await session.turnPromise;

    const msgs = getJsonMessages(browserWs);
    const chatMsgs = msgs.filter((m) => m.type === "chat");
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].text).toBe("Second response!");
  });

  it("reset during handleTurn clears conversation", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();

    // LLM call hangs
    mocks.callLLM.mockImplementationOnce(
      (_msgs: any, _tools: any, _key: any, _model: any, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();
    browserWs.sent.length = 0;

    getSttEvents().onTurn("Hello");
    await Promise.resolve();

    // Reset while LLM is in progress
    await session.onReset();

    const msgs = getJsonMessages(browserWs);
    expect(msgs.some((m) => m.type === "reset")).toBe(true);
    expect(msgs.some((m) => m.type === "chat")).toBe(false);
  });

  it("double cancel is idempotent", async () => {
    const { deps, mocks } = createTestDeps();
    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();
    browserWs.sent.length = 0;

    await session.onCancel();
    await session.onCancel();

    const msgs = getJsonMessages(browserWs);
    const cancelMsgs = msgs.filter((m) => m.type === "cancelled");
    expect(cancelMsgs).toHaveLength(2);
    expect(mocks.sttHandle.clear).toHaveBeenCalledTimes(2);
  });
});
