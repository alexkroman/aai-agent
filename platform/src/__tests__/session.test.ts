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

    it("skips greeting TTS when no TTS API key", async () => {
      delete process.env.ASSEMBLYAI_TTS_API_KEY;

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();

      expect(mockTtsSynthesize).not.toHaveBeenCalled();
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

    it("sends tts_done when no TTS API key", async () => {
      delete process.env.ASSEMBLYAI_TTS_API_KEY;
      mockCallLLM.mockResolvedValueOnce(llmResponse("Response"));

      const session = new VoiceSession("sess-1", browserWs as any, defaultConfig);
      await session.start();
      browserWs.sent.length = 0;

      capturedSttEvents!.onTurn("Hi");

      await vi.waitFor(() => {
        const msgs = getJsonMessages(browserWs);
        return expect(msgs.some((m) => m.type === "tts_done")).toBeTruthy();
      });
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
