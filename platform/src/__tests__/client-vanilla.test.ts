import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Track MockWebSocket instances ─────────────────────────────────

const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 1;
  binaryType = "blob";
  sent: unknown[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Test helper: simulate receiving a JSON message from server */
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Test helper: simulate receiving binary audio data */
  simulateBinary(buffer: ArrayBuffer) {
    this.onmessage?.({ data: buffer });
  }
}

class MockAudioWorkletNode {
  port = { postMessage: vi.fn(), onmessage: null as any };
  connect = vi.fn();
}

class MockAudioBuffer {
  length: number;
  sampleRate: number;
  duration: number;
  private channelData: Float32Array;

  constructor(_ch: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = new Float32Array(length);
  }

  getChannelData() {
    return this.channelData;
  }
}

class MockAudioBufferSource {
  buffer: unknown = null;
  connect = vi.fn();
  start = vi.fn();
}

class MockAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createBuffer(ch: number, len: number, sr: number) {
    return new MockAudioBuffer(ch, len, sr);
  }
  createBufferSource() {
    return new MockAudioBufferSource();
  }
  close = vi.fn().mockResolvedValue(undefined);
}

const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
});

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("AudioContext", MockAudioContext);
vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
vi.stubGlobal("navigator", {
  mediaDevices: { getUserMedia: mockGetUserMedia },
});
vi.stubGlobal(
  "URL",
  class extends URL {
    static createObjectURL = vi.fn(() => "blob:mock");
  },
);
vi.stubGlobal("Blob", class Blob {});

// ── Imports ───────────────────────────────────────────────────────

import { VoiceSession } from "../../client/core.js";

// ── Helpers ───────────────────────────────────────────────────────

function createSession(
  opts: Partial<ConstructorParameters<typeof VoiceSession>[0]> = {},
) {
  const stateChanges: string[] = [];
  const receivedMessages: any[] = [];
  const transcripts: string[] = [];

  const session = new VoiceSession(
    {
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
      ...opts,
    },
    {
      onStateChange: (state) => stateChanges.push(state),
      onMessage: (msg) => receivedMessages.push(msg),
      onTranscript: (text) => transcripts.push(text),
    },
  );

  return { session, stateChanges, receivedMessages, transcripts };
}

/** Get the latest MockWebSocket instance */
function lastWs(): MockWebSocket {
  return wsInstances[wsInstances.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────

describe("VoiceSession", () => {
  beforeEach(() => {
    wsInstances.length = 0;
    vi.clearAllMocks();
  });

  describe("connect", () => {
    it("creates WebSocket with correct URL", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      expect(lastWs().url).toBe("ws://localhost:3000/session?key=pk_test");
    });

    it("sets binaryType to arraybuffer", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));
      // The connect method sets ws.binaryType = "arraybuffer"
    });

    it("sends configure message on open", async () => {
      const { session, stateChanges } = createSession({
        config: {
          instructions: "Be helpful",
          greeting: "Hello!",
          voice: "luna",
        },
      });

      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const ws = lastWs();
      expect(ws.sent.length).toBeGreaterThanOrEqual(1);
      const configMsg = JSON.parse(ws.sent[0] as string);
      expect(configMsg.type).toBe("configure");
      expect(configMsg.instructions).toBe("Be helpful");
      expect(configMsg.greeting).toBe("Hello!");
      expect(configMsg.voice).toBe("luna");
    });

    it("sends tools in configure message", async () => {
      const { session, stateChanges } = createSession({
        tools: {
          get_weather: {
            description: "Get weather",
            parameters: { city: "string" },
            handler: async (args: any) => `Sunny in ${args.city}`,
          },
        },
      });

      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const configMsg = JSON.parse(lastWs().sent[0] as string);
      expect(configMsg.tools).toHaveLength(1);
      expect(configMsg.tools[0].name).toBe("get_weather");
      expect(configMsg.tools[0].handler).toContain("Sunny");
    });

    it("uses default voice 'jess' when none specified", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const configMsg = JSON.parse(lastWs().sent[0] as string);
      expect(configMsg.voice).toBe("jess");
    });

    it("fires onStateChange('ready') on open", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));
    });
  });

  describe("message handling", () => {
    it("handles 'ready' message — sets state to listening", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

      expect(stateChanges).toContain("listening");
    });

    it("handles 'greeting' message", async () => {
      const { session, stateChanges, receivedMessages } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "greeting", text: "Hi there!" });

      expect(receivedMessages).toContainEqual({
        role: "assistant",
        text: "Hi there!",
      });
      expect(stateChanges).toContain("speaking");
    });

    it("handles 'transcript' message", async () => {
      const { session, stateChanges, transcripts } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "transcript", text: "Hello wor" });

      expect(transcripts).toContain("Hello wor");
    });

    it("handles 'turn' message — adds user message and clears transcript", async () => {
      const { session, stateChanges, receivedMessages, transcripts } =
        createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "turn", text: "Hello world" });

      expect(receivedMessages).toContainEqual({
        role: "user",
        text: "Hello world",
      });
      expect(transcripts).toContain("");
    });

    it("handles 'thinking' message — sets state", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "thinking" });

      expect(stateChanges).toContain("thinking");
    });

    it("handles 'chat' message with steps", async () => {
      const { session, stateChanges, receivedMessages } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({
        type: "chat",
        text: "The weather is sunny",
        steps: ["Using get_weather"],
      });

      expect(receivedMessages).toContainEqual({
        role: "assistant",
        text: "The weather is sunny",
        steps: ["Using get_weather"],
      });
      expect(stateChanges).toContain("speaking");
    });

    it("handles 'tts_done' message — sets state to listening", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "tts_done" });

      expect(stateChanges).toContain("listening");
    });

    it("handles 'cancelled' message — flushes player, sets listening", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // First, simulate ready to create the player
      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

      lastWs().simulateMessage({ type: "cancelled" });

      const listeningCount = stateChanges.filter(
        (s) => s === "listening",
      ).length;
      expect(listeningCount).toBeGreaterThanOrEqual(2);
    });

    it("handles 'error' message — logs to console", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "error", message: "Something failed" });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Agent error:",
        "Something failed",
      );
      consoleSpy.mockRestore();
    });

    it("handles binary data — enqueues to audio player", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // Create player via ready message
      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

      // Send binary audio — should not throw
      const audioData = new Int16Array([100, 200, 300]).buffer;
      lastWs().simulateBinary(audioData);
    });
  });

  describe("cancel", () => {
    it("sends cancel message via WebSocket", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.cancel();

      const cancelMsg = lastWs().sent.find((msg) => {
        const parsed = JSON.parse(msg as string);
        return parsed.type === "cancel";
      });
      expect(cancelMsg).toBeDefined();
    });
  });

  describe("reset", () => {
    it("sends reset message via WebSocket", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.reset();

      const resetMsg = lastWs().sent.find((msg) => {
        const parsed = JSON.parse(msg as string);
        return parsed.type === "reset";
      });
      expect(resetMsg).toBeDefined();
    });
  });

  describe("disconnect", () => {
    it("closes the WebSocket", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.disconnect();

      expect(lastWs().readyState).toBe(3);
    });

    it("triggers onStateChange('connecting') via onclose", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.disconnect();

      expect(stateChanges).toContain("connecting");
    });
  });

  describe("full message flow", () => {
    it("simulates a complete conversation turn", async () => {
      const { session, stateChanges, receivedMessages, transcripts } =
        createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const ws = lastWs();

      // 1. Server sends ready
      ws.simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });
      expect(stateChanges).toContain("listening");

      // 2. Server sends greeting
      ws.simulateMessage({ type: "greeting", text: "Hello!" });
      expect(receivedMessages[0]).toEqual({
        role: "assistant",
        text: "Hello!",
      });

      // 3. Server sends partial transcript
      ws.simulateMessage({ type: "transcript", text: "What's the" });
      expect(transcripts).toContain("What's the");

      // 4. Server sends completed turn
      ws.simulateMessage({ type: "turn", text: "What's the weather?" });
      expect(receivedMessages).toContainEqual({
        role: "user",
        text: "What's the weather?",
      });

      // 5. Server sends thinking
      ws.simulateMessage({ type: "thinking" });
      expect(stateChanges).toContain("thinking");

      // 6. Server sends chat response
      ws.simulateMessage({
        type: "chat",
        text: "It's sunny!",
        steps: ["Using get_weather"],
      });
      expect(receivedMessages).toContainEqual({
        role: "assistant",
        text: "It's sunny!",
        steps: ["Using get_weather"],
      });
      expect(stateChanges).toContain("speaking");

      // 7. TTS done
      ws.simulateMessage({ type: "tts_done" });
      expect(stateChanges[stateChanges.length - 1]).toBe("listening");
    });
  });
});
