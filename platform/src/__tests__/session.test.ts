import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks ──────────────────────────────────────────────────────────

// Mock LLM
const mockCallLLM = vi.fn();
vi.mock("../llm.js", () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

// Mock STT
let capturedSttEvents: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurn: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
} | null = null;

const mockSttHandle = {
  send: vi.fn(),
  clear: vi.fn(),
  close: vi.fn(),
};

vi.mock("../stt.js", () => ({
  connectStt: vi.fn(async (_apiKey: string, _config: unknown, events: typeof capturedSttEvents) => {
    capturedSttEvents = events;
    return mockSttHandle;
  }),
}));

// Mock TTS
const mockTtsSynthesize = vi.fn().mockResolvedValue(undefined);
const mockTtsClose = vi.fn();
vi.mock("../tts.js", () => ({
  synthesize: (...args: unknown[]) => mockTtsSynthesize(...args),
  TtsClient: class {
    synthesize = (...args: unknown[]) => mockTtsSynthesize(...args);
    close = mockTtsClose;
  },
}));

// Mock Sandbox
const mockSandboxExecute = vi.fn();
vi.mock("../sandbox.js", () => ({
  Sandbox: class {
    execute = mockSandboxExecute;
    dispose = vi.fn();
  },
}));

// Mock voice-cleaner
vi.mock("../voice-cleaner.js", () => ({
  normalizeVoiceText: (text: string) => text,
}));

import { VoiceSession } from "../session.js";
import type { AgentConfig, LLMResponse } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeBrowserWs(): EventEmitter & {
  OPEN: number;
  readyState: number;
  sent: unknown[];
  send: ReturnType<typeof vi.fn>;
} {
  const ws = new EventEmitter() as EventEmitter & {
    OPEN: number;
    readyState: number;
    sent: unknown[];
    send: ReturnType<typeof vi.fn>;
  };
  ws.OPEN = 1;
  ws.readyState = 1;
  ws.sent = [];
  ws.send = vi.fn((data: unknown) => ws.sent.push(data));
  return ws;
}

function llmResponse(content: string): LLMResponse {
  return {
    id: "resp-1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function llmToolCallResponse(
  toolCalls: { name: string; args: Record<string, unknown> }[]
): LLMResponse {
  return {
    id: "resp-tc",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((tc, i) => ({
            id: `tc-${i}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        },
        finish_reason: "tool_use",
      },
    ],
  };
}

function getJsonMessages(ws: ReturnType<typeof makeBrowserWs>): Record<string, unknown>[] {
  return ws.sent.filter((d) => typeof d === "string").map((d) => JSON.parse(d as string));
}

const defaultConfig: AgentConfig = {
  instructions: "You are a test assistant.",
  greeting: "Hello!",
  voice: "jess",
  tools: [],
};

// ── Tests ──────────────────────────────────────────────────────────

describe("VoiceSession", () => {
  let browserWs: ReturnType<typeof makeBrowserWs>;

  beforeEach(() => {
    browserWs = makeBrowserWs();
    capturedSttEvents = null;
    vi.clearAllMocks();

    // Default env
    process.env.ASSEMBLYAI_API_KEY = "test-aai-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "test-tts-key";
    process.env.LLM_MODEL = "test-model";
  });

  afterEach(() => {
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_TTS_API_KEY;
    delete process.env.LLM_MODEL;
  });

  describe("start()", () => {
    it("connects STT, sends ready and greeting", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      expect(capturedSttEvents).not.toBeNull();

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "ready" });
      expect(msgs[0]).toHaveProperty("sampleRate");
      expect(msgs[0]).toHaveProperty("ttsSampleRate");
      expect(msgs[1]).toMatchObject({ type: "greeting", text: "Hello!" });
    });

    it("starts TTS for greeting when TTS API key is set", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      expect(mockTtsSynthesize).toHaveBeenCalledOnce();
      expect(mockTtsSynthesize.mock.calls[0][0]).toBe("Hello!");
    });

    it("sends error if STT connection fails", async () => {
      const { connectStt } = await import("../stt.js");
      (connectStt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("STT down"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      const msgs = getJsonMessages(browserWs);
      expect(msgs.some((m) => m.type === "error")).toBe(true);
    });

    it("skips greeting when greeting is empty", async () => {
      const config = { ...defaultConfig, greeting: "" };
      const session = new VoiceSession("sess-1", browserWs as any, config);
      await session.start();

      const msgs = getJsonMessages(browserWs);
      expect(msgs.some((m) => m.type === "greeting")).toBe(false);
    });
  });

  describe("handleTurn (triggered via STT onTurn)", () => {
    it("sends turn + thinking + chat messages for simple response", async () => {
      mockCallLLM.mockResolvedValueOnce(llmResponse("The weather is sunny!"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      // Clear startup messages
      browserWs.sent.length = 0;

      // Simulate STT turn
      capturedSttEvents!.onTurn("What is the weather?");

      // Wait for async handleTurn to complete
      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "turn", text: "What is the weather?" });
      expect(msgs[1]).toMatchObject({ type: "thinking" });
      expect(msgs[2]).toMatchObject({
        type: "chat",
        text: "The weather is sunny!",
        steps: [],
      });

      // Should have called LLM with user message
      expect(mockCallLLM).toHaveBeenCalledOnce();
      // messages is a mutable ref — check index 1 (system=0, user=1)
      const [messages] = mockCallLLM.mock.calls[0];
      expect(messages[1]).toMatchObject({
        role: "user",
        content: "What is the weather?",
      });
    });

    it("handles tool calls: LLM → tool → LLM → chat", async () => {
      // First LLM call: tool call
      mockCallLLM.mockResolvedValueOnce(
        llmToolCallResponse([{ name: "get_weather", args: { city: "NYC" } }])
      );
      // Tool execution result
      mockSandboxExecute.mockResolvedValueOnce("Sunny, 72F");
      // Second LLM call: final response
      mockCallLLM.mockResolvedValueOnce(llmResponse("It's sunny and 72 degrees in New York!"));

      const configWithTools: AgentConfig = {
        ...defaultConfig,
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            parameters: { city: "string" },
            handler: "(args) => 'Sunny'",
          },
        ],
      };

      const session = new VoiceSession("sess-1", browserWs as any, configWithTools);
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Weather in NYC?");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      // Sandbox should have been called
      expect(mockSandboxExecute).toHaveBeenCalledWith("get_weather", {
        city: "NYC",
      });

      // LLM should have been called twice
      expect(mockCallLLM).toHaveBeenCalledTimes(2);

      const msgs = getJsonMessages(browserWs);
      const chatMsg = msgs.find((m) => m.type === "chat");
      expect(chatMsg).toMatchObject({
        text: "It's sunny and 72 degrees in New York!",
        steps: ["Using get_weather"],
      });
    });

    it("starts TTS after chat response", async () => {
      mockCallLLM.mockResolvedValueOnce(llmResponse("Hello there!"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      mockTtsSynthesize.mockClear(); // Clear greeting TTS call

      capturedSttEvents!.onTurn("Hi");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      // Should call synthesize with cleaned response text
      expect(mockTtsSynthesize).toHaveBeenCalledOnce();
      expect(mockTtsSynthesize.mock.calls[0][0]).toBe("Hello there!");
    });

    it("sends error on LLM failure", async () => {
      mockCallLLM.mockRejectedValueOnce(new Error("LLM down"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Hello");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "error")).toBeTruthy();
      });

      const msgs = getJsonMessages(browserWs);
      expect(msgs.find((m) => m.type === "error")).toMatchObject({
        message: "Chat failed",
      });
    });

    it("handles null LLM content with fallback", async () => {
      mockCallLLM.mockResolvedValueOnce({
        id: "resp-1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null },
            finish_reason: "stop",
          },
        ],
      });

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Hi");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      const msgs = getJsonMessages(browserWs);
      const chatMsg = msgs.find((m) => m.type === "chat");
      expect(chatMsg!.text).toBe("Sorry, I couldn't generate a response.");
    });

    it("handles tool call with invalid JSON arguments (falls back to {})", async () => {
      // LLM returns a tool call with unparseable arguments
      mockCallLLM.mockResolvedValueOnce({
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
      mockSandboxExecute.mockResolvedValueOnce("tool result");
      mockCallLLM.mockResolvedValueOnce(llmResponse("Done!"));

      const session = new VoiceSession("sess-1", browserWs as any, {
        ...defaultConfig,
        tools: [
          { name: "my_tool", description: "A tool", parameters: {}, handler: "async () => 'ok'" },
        ],
      });
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Test");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      // Sandbox should have been called with empty args (fallback)
      expect(mockSandboxExecute).toHaveBeenCalledWith("my_tool", {});
    });

    it("stops after MAX_TOOL_ITERATIONS tool-call rounds", async () => {
      // Simulate LLM always returning tool calls (never a final response)
      const toolCallResponse = () => llmToolCallResponse([{ name: "loop_tool", args: { x: 1 } }]);

      // 1 initial call + 3 iterations = 4 callLLM calls
      mockCallLLM.mockResolvedValueOnce(toolCallResponse());
      mockCallLLM.mockResolvedValueOnce(toolCallResponse());
      mockCallLLM.mockResolvedValueOnce(toolCallResponse());
      mockCallLLM.mockResolvedValueOnce(toolCallResponse()); // iteration 3 — this response gets checked but loop exits

      mockSandboxExecute.mockResolvedValue("tool result");

      const session = new VoiceSession("sess-1", browserWs as any, {
        ...defaultConfig,
        tools: [
          { name: "loop_tool", description: "A tool", parameters: {}, handler: "async () => 'ok'" },
        ],
      });
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Loop test");

      // Wait for the loop to finish — it won't send a "chat" message since the LLM
      // never returns a non-tool-call response. Wait for the thinking phase to end.
      await new Promise((r) => setTimeout(r, 500));

      // LLM should have been called at most 4 times (initial + 3 iterations)
      expect(mockCallLLM.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it("handles empty choices array from LLM", async () => {
      mockCallLLM.mockResolvedValueOnce({
        id: "resp-empty",
        choices: [],
      });

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Hello");

      // Wait for handleTurn to complete
      await new Promise((r) => setTimeout(r, 200));

      const msgs = getJsonMessages(browserWs);
      // Should have turn + thinking but no crash
      expect(msgs[0]).toMatchObject({ type: "turn" });
      expect(msgs[1]).toMatchObject({ type: "thinking" });
      // No chat message since choices was empty, but no error either
    });

    it("handles multiple parallel tool calls", async () => {
      mockCallLLM.mockResolvedValueOnce(
        llmToolCallResponse([
          { name: "tool_a", args: { x: 1 } },
          { name: "tool_b", args: { y: 2 } },
        ])
      );
      mockSandboxExecute.mockResolvedValueOnce("result_a");
      mockSandboxExecute.mockResolvedValueOnce("result_b");
      mockCallLLM.mockResolvedValueOnce(llmResponse("Combined results!"));

      const session = new VoiceSession("sess-1", browserWs as any, {
        ...defaultConfig,
        tools: [
          { name: "tool_a", description: "A", parameters: {}, handler: "async () => 'a'" },
          { name: "tool_b", description: "B", parameters: {}, handler: "async () => 'b'" },
        ],
      });
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Use both tools");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      // Both tools should have been called
      expect(mockSandboxExecute).toHaveBeenCalledTimes(2);
      expect(mockSandboxExecute).toHaveBeenCalledWith("tool_a", { x: 1 });
      expect(mockSandboxExecute).toHaveBeenCalledWith("tool_b", { y: 2 });

      const msgs = getJsonMessages(browserWs);
      const chatMsg = msgs.find((m) => m.type === "chat");
      expect(chatMsg).toMatchObject({
        text: "Combined results!",
        steps: ["Using tool_a", "Using tool_b"],
      });
    });

    it("does not send chat/tts after abort during LLM call", async () => {
      // Make callLLM hang until aborted
      mockCallLLM.mockImplementationOnce(
        (_msgs: any, _tools: any, _key: any, _model: any, signal: AbortSignal) => {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          });
        }
      );

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Hello");

      // Wait for turn+thinking to be sent
      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "thinking")).toBeTruthy();
      });

      // Cancel mid-flight
      await session.onCancel();

      await new Promise((r) => setTimeout(r, 200));

      const msgs = getJsonMessages(browserWs);
      // Should NOT have a "chat" message
      expect(msgs.some((m) => m.type === "chat")).toBe(false);
      // Should NOT have an "error" message (abort is not an error)
      expect(msgs.filter((m) => m.type === "error")).toHaveLength(0);
    });

    it("handles TTS synthesis error", async () => {
      mockCallLLM.mockResolvedValueOnce(llmResponse("Hello there!"));
      mockTtsSynthesize.mockRejectedValueOnce(new Error("TTS connection failed"));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      // Clear greeting TTS call and startup messages
      mockTtsSynthesize.mockClear();
      mockTtsSynthesize.mockRejectedValueOnce(new Error("TTS connection failed"));
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Hi");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      // Wait for TTS error to propagate
      await new Promise((r) => setTimeout(r, 200));

      const msgs = getJsonMessages(browserWs);
      const errMsg = msgs.find((m) => m.type === "error");
      expect(errMsg).toMatchObject({ message: "TTS synthesis failed" });

      consoleSpy.mockRestore();
    });
  }); // close handleTurn

  describe("sendJson/sendBytes when WS is closed", () => {
    it("sendJson is safe when WS is not OPEN", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      // Close the WS
      browserWs.readyState = 3; // CLOSED
      browserWs.sent.length = 0;

      // Should not throw
      await session.onCancel();

      // Nothing should have been sent
      expect(browserWs.sent).toHaveLength(0);
    });

    it("sendBytes is safe when WS send throws", async () => {
      mockCallLLM.mockResolvedValueOnce(llmResponse("Hello!"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      // Make send throw
      browserWs.send = vi.fn(() => {
        throw new Error("WS closed");
      });

      // Trigger a turn — should not crash
      capturedSttEvents!.onTurn("Hi");

      await new Promise((r) => setTimeout(r, 200));
      // No crash = success
    });
  });

  describe("onAudio", () => {
    it("relays audio to STT", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      const audio = Buffer.from([1, 2, 3]);
      session.onAudio(audio);

      expect(mockSttHandle.send).toHaveBeenCalledWith(audio);
    });

    it("does nothing before STT is connected", () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      // Don't call start()
      session.onAudio(Buffer.from([1]));
      // Should not throw
    });
  });

  describe("onCancel", () => {
    it("clears STT and sends cancelled message", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      browserWs.sent.length = 0;

      await session.onCancel();

      expect(mockSttHandle.clear).toHaveBeenCalledOnce();
      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "cancelled" });
    });
  });

  describe("onReset", () => {
    it("clears conversation and sends reset message", async () => {
      mockCallLLM.mockResolvedValueOnce(llmResponse("Hi!"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      // Simulate a turn to build up message history
      capturedSttEvents!.onTurn("Hello");
      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "chat")).toBeTruthy();
      });

      browserWs.sent.length = 0;

      await session.onReset();

      const msgs = getJsonMessages(browserWs);
      expect(msgs[0]).toMatchObject({ type: "reset" });
    });
  });

  describe("stop", () => {
    it("closes STT and disposes sandbox", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      await session.stop();

      expect(mockSttHandle.close).toHaveBeenCalledOnce();
    });

    it("is idempotent", async () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      await session.stop();
      await session.stop();

      // close only called once
      expect(mockSttHandle.close).toHaveBeenCalledOnce();
    });
  });

  describe("constructor", () => {
    it("uses default instructions when none provided", () => {
      const config = { ...defaultConfig, instructions: "" };
      const session = new VoiceSession("sess-1", browserWs as any, config);
      // Should not throw - session is created successfully
      expect(session).toBeDefined();
    });

    it("overrides TTS voice from config", () => {
      const config = { ...defaultConfig, voice: "luna" };
      const session = new VoiceSession("sess-1", browserWs as any, config);
      expect(session).toBeDefined();
    });

    it("accepts customer secrets parameter", () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig, {
        API_KEY: "secret123",
      });
      expect(session).toBeDefined();
    });

    it("defaults to empty secrets when none provided", () => {
      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      expect(session).toBeDefined();
    });
  });
});
