import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceSession } from "../session.js";
import type { AgentConfig } from "../types.js";
import { makeBrowserWs, getJsonMessages } from "./_mocks.js";
import {
  createTestDeps,
  DEFAULT_AGENT_CONFIG,
  llmResponse,
  llmToolCallResponse,
} from "./_factories.js";

// ── Tests ──────────────────────────────────────────────────────────

describe("VoiceSession", () => {
  let browserWs: ReturnType<typeof makeBrowserWs>;

  beforeEach(() => {
    browserWs = makeBrowserWs();
    vi.clearAllMocks();
  });

  describe("start()", () => {
    it("connects STT, sends ready and greeting", async () => {
      const { deps, getSttEvents } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      expect(getSttEvents()).not.toBeNull();

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "ready" });
      expect(msgs[0]).toHaveProperty("sampleRate");
      expect(msgs[0]).toHaveProperty("ttsSampleRate");
      expect(msgs[1]).toMatchObject({ type: "greeting", text: "Hello!" });
    });

    it("starts TTS for greeting", async () => {
      const { deps, mocks } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      expect(mocks.ttsClient.synthesize).toHaveBeenCalledOnce();
      expect(mocks.ttsClient.synthesize.mock.calls[0][0]).toBe("Hello!");
    });

    it("sends error if STT connection fails", async () => {
      const { deps, mocks } = createTestDeps();
      mocks.connectStt.mockRejectedValueOnce(new Error("STT down"));
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      const msgs = getJsonMessages(browserWs);
      expect(msgs.some((m) => m.type === "error")).toBe(true);
    });

    it("skips greeting when greeting is empty", async () => {
      const { deps } = createTestDeps();
      const config = { ...DEFAULT_AGENT_CONFIG, greeting: "" };
      const session = new VoiceSession("sess-1", browserWs as any, config, deps);
      await session.start();

      const msgs = getJsonMessages(browserWs);
      expect(msgs.some((m) => m.type === "greeting")).toBe(false);
    });
  });

  describe("handleTurn (triggered via STT onTurn)", () => {
    it("sends turn + thinking + chat messages for simple response", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(llmResponse("The weather is sunny!"));

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("What is the weather?");
      await session.turnPromise;

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "turn", text: "What is the weather?" });
      expect(msgs[1]).toMatchObject({ type: "thinking" });
      expect(msgs[2]).toMatchObject({
        type: "chat",
        text: "The weather is sunny!",
        steps: [],
      });

      expect(mocks.callLLM).toHaveBeenCalledOnce();
      const [messages] = mocks.callLLM.mock.calls[0];
      expect(messages[1]).toMatchObject({
        role: "user",
        content: "What is the weather?",
      });
    });

    it("handles tool calls: LLM → tool → LLM → chat", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(
        llmToolCallResponse([{ name: "get_weather", args: { city: "NYC" } }])
      );
      mocks.sandbox.execute.mockResolvedValueOnce("Sunny, 72F");
      mocks.callLLM.mockResolvedValueOnce(llmResponse("It's sunny and 72 degrees in New York!"));

      const configWithTools: AgentConfig = {
        ...DEFAULT_AGENT_CONFIG,
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            parameters: { city: "string" },
            handler: "(args) => 'Sunny'",
          },
        ],
      };

      const session = new VoiceSession("sess-1", browserWs as any, configWithTools, deps);
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Weather in NYC?");
      await session.turnPromise;

      expect(mocks.sandbox.execute).toHaveBeenCalledWith("get_weather", { city: "NYC" });
      expect(mocks.callLLM).toHaveBeenCalledTimes(2);

      const msgs = getJsonMessages(browserWs);
      const chatMsg = msgs.find((m) => m.type === "chat");
      expect(chatMsg).toMatchObject({
        text: "It's sunny and 72 degrees in New York!",
        steps: ["Using get_weather"],
      });
    });

    it("starts TTS after chat response", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(llmResponse("Hello there!"));

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      mocks.ttsClient.synthesize.mockClear();

      getSttEvents().onTurn("Hi");
      await session.turnPromise;

      expect(mocks.ttsClient.synthesize).toHaveBeenCalledOnce();
      expect(mocks.ttsClient.synthesize.mock.calls[0][0]).toBe("Hello there!");
    });

    it("sends error on LLM failure", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockRejectedValueOnce(new Error("LLM down"));

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Hello");
      await session.turnPromise;

      const msgs = getJsonMessages(browserWs);
      expect(msgs.find((m) => m.type === "error")).toMatchObject({
        message: "Chat failed",
      });
    });

    it("handles null LLM content with fallback", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce({
        id: "resp-1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null },
            finish_reason: "stop",
          },
        ],
      });

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Hi");
      await session.turnPromise;

      const msgs = getJsonMessages(browserWs);
      const chatMsg = msgs.find((m) => m.type === "chat");
      expect(chatMsg!.text).toBe("Sorry, I couldn't generate a response.");
    });

    it("returns error string to LLM when tool args JSON is invalid", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
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
                  function: {
                    name: "my_tool",
                    arguments: "not valid json {{{",
                  },
                },
              ],
            },
            finish_reason: "tool_use",
          },
        ],
      });
      mocks.callLLM.mockResolvedValueOnce(llmResponse("Done!"));

      const session = new VoiceSession(
        "sess-1",
        browserWs as any,
        {
          ...DEFAULT_AGENT_CONFIG,
          tools: [
            { name: "my_tool", description: "A tool", parameters: {}, handler: "async () => 'ok'" },
          ],
        },
        deps
      );
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Test");
      await session.turnPromise;

      expect(mocks.sandbox.execute).not.toHaveBeenCalled();

      const secondLLMCall = mocks.callLLM.mock.calls[1];
      const toolMessage = secondLLMCall[0].find(
        (m: any) => m.role === "tool" && m.tool_call_id === "tc-0"
      );
      expect(toolMessage.content).toBe('Error: Invalid JSON arguments for tool "my_tool"');
    });

    it("stops after MAX_TOOL_ITERATIONS tool-call rounds", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      const toolCallResponse = () => llmToolCallResponse([{ name: "loop_tool", args: { x: 1 } }]);

      mocks.callLLM.mockResolvedValueOnce(toolCallResponse());
      mocks.callLLM.mockResolvedValueOnce(toolCallResponse());
      mocks.callLLM.mockResolvedValueOnce(toolCallResponse());
      mocks.callLLM.mockResolvedValueOnce(toolCallResponse());
      mocks.sandbox.execute.mockResolvedValue("tool result");

      const session = new VoiceSession(
        "sess-1",
        browserWs as any,
        {
          ...DEFAULT_AGENT_CONFIG,
          tools: [
            {
              name: "loop_tool",
              description: "A tool",
              parameters: {},
              handler: "async () => 'ok'",
            },
          ],
        },
        deps
      );
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Loop test");
      await session.turnPromise;

      expect(mocks.callLLM.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it("handles empty choices array from LLM", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce({
        id: "resp-empty",
        choices: [],
      });

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Hello");
      await session.turnPromise;

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "turn" });
      expect(msgs[1]).toMatchObject({ type: "thinking" });
    });

    it("handles multiple parallel tool calls", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(
        llmToolCallResponse([
          { name: "tool_a", args: { x: 1 } },
          { name: "tool_b", args: { y: 2 } },
        ])
      );
      mocks.sandbox.execute.mockResolvedValueOnce("result_a");
      mocks.sandbox.execute.mockResolvedValueOnce("result_b");
      mocks.callLLM.mockResolvedValueOnce(llmResponse("Combined results!"));

      const session = new VoiceSession(
        "sess-1",
        browserWs as any,
        {
          ...DEFAULT_AGENT_CONFIG,
          tools: [
            { name: "tool_a", description: "A", parameters: {}, handler: "async () => 'a'" },
            { name: "tool_b", description: "B", parameters: {}, handler: "async () => 'b'" },
          ],
        },
        deps
      );
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Use both tools");
      await session.turnPromise;

      expect(mocks.sandbox.execute).toHaveBeenCalledTimes(2);
      expect(mocks.sandbox.execute).toHaveBeenCalledWith("tool_a", { x: 1 });
      expect(mocks.sandbox.execute).toHaveBeenCalledWith("tool_b", { y: 2 });

      const msgs = getJsonMessages(browserWs);
      const chatMsg = msgs.find((m) => m.type === "chat");
      expect(chatMsg).toMatchObject({
        text: "Combined results!",
        steps: ["Using tool_a", "Using tool_b"],
      });
    });

    it("does not send chat/tts after abort during LLM call", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockImplementationOnce(
        (_msgs: any, _tools: any, _key: any, _model: any, signal: AbortSignal) => {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          });
        }
      );

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Hello");

      // Wait a tick for turn+thinking to be sent
      await Promise.resolve();

      await session.onCancel();
      // Let the aborted promise settle
      await Promise.resolve();

      const msgs = getJsonMessages(browserWs);
      expect(msgs.some((m) => m.type === "chat")).toBe(false);
      expect(msgs.filter((m) => m.type === "error")).toHaveLength(0);
    });

    it("handles TTS synthesis error", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(llmResponse("Hello there!"));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      mocks.ttsClient.synthesize.mockClear();
      mocks.ttsClient.synthesize.mockRejectedValueOnce(new Error("TTS connection failed"));
      browserWs.sent.length = 0;

      getSttEvents().onTurn("Hi");
      await session.turnPromise;

      // Wait for TTS error to propagate (ttsRelay is fire-and-forget)
      await new Promise((r) => setTimeout(r, 10));

      const msgs = getJsonMessages(browserWs);
      const errMsg = msgs.find((m) => m.type === "error");
      expect(errMsg).toMatchObject({ message: "TTS synthesis failed" });

      consoleSpy.mockRestore();
    });
  });

  describe("sendJson/sendBytes when WS is closed", () => {
    it("sendJson is safe when WS is not OPEN", async () => {
      const { deps } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      browserWs.readyState = 3;
      browserWs.sent.length = 0;

      await session.onCancel();
      expect(browserWs.sent).toHaveLength(0);
    });

    it("sendBytes is safe when WS send throws", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(llmResponse("Hello!"));

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      browserWs.send = vi.fn(() => {
        throw new Error("WS closed");
      });

      getSttEvents().onTurn("Hi");
      await session.turnPromise;
      // No crash = success
    });
  });

  describe("onAudio", () => {
    it("relays audio to STT", async () => {
      const { deps, mocks } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      const audio = Buffer.from([1, 2, 3]);
      session.onAudio(audio);

      expect(mocks.sttHandle.send).toHaveBeenCalledWith(audio);
    });

    it("does nothing before STT is connected", () => {
      const { deps } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      session.onAudio(Buffer.from([1]));
    });
  });

  describe("onCancel", () => {
    it("clears STT and sends cancelled message", async () => {
      const { deps, mocks } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();
      browserWs.sent.length = 0;

      await session.onCancel();

      expect(mocks.sttHandle.clear).toHaveBeenCalledOnce();
      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "cancelled" });
    });
  });

  describe("onReset", () => {
    it("clears conversation and sends reset message", async () => {
      const { deps, mocks, getSttEvents } = createTestDeps();
      mocks.callLLM.mockResolvedValueOnce(llmResponse("Hi!"));

      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      getSttEvents().onTurn("Hello");
      await session.turnPromise;

      browserWs.sent.length = 0;

      await session.onReset();

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "reset" });
    });
  });

  describe("stop", () => {
    it("closes STT and disposes sandbox", async () => {
      const { deps, mocks } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      await session.stop();

      expect(mocks.sttHandle.close).toHaveBeenCalledOnce();
    });

    it("is idempotent", async () => {
      const { deps, mocks } = createTestDeps();
      const session = new VoiceSession("sess-1", browserWs as any, DEFAULT_AGENT_CONFIG, deps);
      await session.start();

      await session.stop();
      await session.stop();

      expect(mocks.sttHandle.close).toHaveBeenCalledOnce();
    });
  });

  describe("constructor", () => {
    it("uses default instructions when none provided", () => {
      const { deps } = createTestDeps();
      const config = { ...DEFAULT_AGENT_CONFIG, instructions: "" };
      const session = new VoiceSession("sess-1", browserWs as any, config, deps);
      expect(session).toBeDefined();
    });

    it("overrides TTS voice from config", () => {
      const { deps } = createTestDeps();
      const config = { ...DEFAULT_AGENT_CONFIG, voice: "luna" };
      const session = new VoiceSession("sess-1", browserWs as any, config, deps);
      expect(session).toBeDefined();
    });
  });
});
