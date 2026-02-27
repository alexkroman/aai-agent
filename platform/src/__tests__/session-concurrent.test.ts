import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceSession } from "../session.js";
import { makeBrowserWs, getJsonMessages } from "./_mocks.js";
import { createTestDeps, DEFAULT_AGENT_CONFIG, llmResponse } from "./_factories.js";

describe("VoiceSession concurrency", () => {
  let browserWs: ReturnType<typeof makeBrowserWs>;

  beforeEach(() => {
    browserWs = makeBrowserWs();
    vi.clearAllMocks();
  });

  it("second turn cancels first turn in progress", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();

    // First LLM call: hangs until abort
    mocks.callLLM.mockImplementationOnce(
      (_msgs: any, _tools: any, _key: any, _model: any, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    // Second LLM call: resolves immediately
    mocks.callLLM.mockResolvedValueOnce(llmResponse("Second answer!"));

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();
    browserWs.sent.length = 0;

    // Fire first turn
    getSttEvents().onTurn("First question");
    await Promise.resolve();

    // Fire second turn immediately (cancels first)
    getSttEvents().onTurn("Second question");
    await session.turnPromise;

    const msgs = getJsonMessages(browserWs);
    const chatMsgs = msgs.filter((m) => m.type === "chat");
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].text).toBe("Second answer!");
  });

  it("audio continues flowing during handleTurn", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();

    // LLM takes a moment
    mocks.callLLM.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                id: "resp-1",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "Done!" },
                    finish_reason: "stop",
                  },
                ],
              }),
            10
          );
        })
    );

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();

    // Start a turn
    getSttEvents().onTurn("Hello");

    // Audio frames should still be relayed during handleTurn
    const audio = Buffer.from([1, 2, 3]);
    session.onAudio(audio);
    session.onAudio(audio);

    expect(mocks.sttHandle.send).toHaveBeenCalledTimes(2);

    await session.turnPromise;
  });

  it("cancel during greeting TTS", async () => {
    const { deps, mocks } = createTestDeps();

    // Make greeting TTS hang until abort
    mocks.ttsClient.synthesize.mockImplementation(
      (_text: string, _onAudio: any, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          signal?.addEventListener("abort", () => resolve(), { once: true });
        })
    );

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();

    // TTS is in progress for greeting, cancel it
    await session.onCancel();

    // Let abort propagate
    await new Promise((r) => setTimeout(r, 10));

    const msgs = getJsonMessages(browserWs);
    expect(msgs.some((m) => m.type === "cancelled")).toBe(true);
  });

  it("turnPromise is null when idle", async () => {
    const { deps } = createTestDeps();
    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();

    expect(session.turnPromise).toBeNull();
  });

  it("turnPromise is set during handleTurn and null after", async () => {
    const { deps, mocks, getSttEvents } = createTestDeps();
    mocks.callLLM.mockResolvedValueOnce(llmResponse("Response!"));

    const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
    await session.start();

    getSttEvents().onTurn("Hello");

    // Should be set during turn
    expect(session.turnPromise).not.toBeNull();

    await session.turnPromise;

    // Should be null after turn completes
    expect(session.turnPromise).toBeNull();
  });
});
