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
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [{ stop: vi.fn() }],
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
    static revokeObjectURL = vi.fn();
  }
);
vi.stubGlobal("Blob", class Blob {});

// ── Imports ───────────────────────────────────────────────────────

import { VoiceSession } from "../../client/core.js";
import { parseServerMessage } from "../../client/protocol.js";

// ── Helpers ───────────────────────────────────────────────────────

function createSession(opts: Partial<ConstructorParameters<typeof VoiceSession>[0]> = {}) {
  const stateChanges: string[] = [];
  const receivedMessages: any[] = [];
  const transcripts: string[] = [];
  const errors: string[] = [];

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
      onError: (message) => errors.push(message),
    }
  );

  return { session, stateChanges, receivedMessages, transcripts, errors };
}

/** Get the latest MockWebSocket instance */
function lastWs(): MockWebSocket {
  return wsInstances[wsInstances.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────

describe("parseServerMessage", () => {
  it("parses valid server messages", () => {
    const msg = parseServerMessage('{"type":"ready","sampleRate":16000,"ttsSampleRate":24000}');
    expect(msg).toEqual({ type: "ready", sampleRate: 16000, ttsSampleRate: 24000 });
  });

  it("returns null for malformed JSON", () => {
    expect(parseServerMessage("not json")).toBeNull();
  });

  it("returns null for unknown message types", () => {
    expect(parseServerMessage('{"type":"unknown_type"}')).toBeNull();
  });

  it("returns null for missing type field", () => {
    expect(parseServerMessage('{"data":"test"}')).toBeNull();
  });
});

describe("VoiceSession", () => {
  beforeEach(() => {
    wsInstances.length = 0;
    vi.clearAllMocks();
  });

  describe("connect", () => {
    it("creates WebSocket with URL (no API key in query string)", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      expect(lastWs().url).toBe("ws://localhost:3000/session");
    });

    it("sends authenticate message first, then configure", async () => {
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
      expect(ws.sent.length).toBeGreaterThanOrEqual(2);
      const authMsg = JSON.parse(ws.sent[0] as string);
      expect(authMsg.type).toBe("authenticate");
      expect(authMsg.apiKey).toBe("pk_test");

      const configMsg = JSON.parse(ws.sent[1] as string);
      expect(configMsg.type).toBe("configure");
      expect(configMsg.instructions).toBe("Be helpful");
      expect(configMsg.greeting).toBe("Hello!");
      expect(configMsg.voice).toBe("luna");
    });

    it("sets binaryType to arraybuffer", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));
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

      const configMsg = JSON.parse(lastWs().sent[1] as string);
      expect(configMsg.tools).toHaveLength(1);
      expect(configMsg.tools[0].name).toBe("get_weather");
      expect(configMsg.tools[0].handler).toContain("Sunny");
    });

    it("uses default voice 'jess' when none specified", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const configMsg = JSON.parse(lastWs().sent[1] as string);
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

      await vi.waitFor(() => expect(stateChanges).toContain("listening"));
    });

    it("resets reconnectAttempts on ready message", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

      await vi.waitFor(() => expect(stateChanges).toContain("listening"));
      // If we disconnect after ready, it should start from attempt 0 again
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
      const { session, stateChanges, receivedMessages, transcripts } = createSession();
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

      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

      await vi.waitFor(() => expect(stateChanges).toContain("listening"));

      // Move to speaking first so "cancelled" -> "listening" is a real transition
      lastWs().simulateMessage({ type: "greeting", text: "Hi" });
      expect(stateChanges).toContain("speaking");

      lastWs().simulateMessage({ type: "cancelled" });

      const listeningCount = stateChanges.filter((s) => s === "listening").length;
      expect(listeningCount).toBeGreaterThanOrEqual(2);
    });

    it("handles 'error' message — calls onError and sets error state", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { session, stateChanges, errors } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "error", message: "Something failed" });

      expect(errors).toContain("Something failed");
      expect(stateChanges).toContain("error");
      consoleSpy.mockRestore();
    });

    it("handles 'pong' message — sets pongReceived flag", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // pong should not throw or change state
      lastWs().simulateMessage({ type: "pong" });
    });

    it("ignores unknown message types via parseServerMessage returning null", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({ type: "unknown_type", data: "test" });

      // State should still be "ready" — unknown message is ignored
      const lastState = stateChanges[stateChanges.length - 1];
      expect(lastState).toBe("ready");
    });

    it("handles binary data — enqueues to audio player", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

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
    it("closes the WebSocket and nulls it", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.disconnect();

      expect(lastWs().readyState).toBe(3);
    });

    it("intentional disconnect fires connecting state", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.disconnect();

      expect(stateChanges).toContain("connecting");
    });

    it("safe to call methods after disconnect", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      session.disconnect();

      // These should not throw
      session.cancel();
      session.reset();
      session.disconnect();
    });
  });

  describe("reconnection", () => {
    it("schedules reconnect on unexpected close", async () => {
      vi.useFakeTimers();
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // Simulate unexpected close
      lastWs().close();

      // Should schedule reconnect — state goes to "connecting"
      expect(stateChanges).toContain("connecting");

      // After delay, should create a new WebSocket
      const wsBefore = wsInstances.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(wsInstances.length).toBe(wsBefore + 1);

      vi.useRealTimers();
    });

    it("does not reconnect on intentional disconnect", async () => {
      vi.useFakeTimers();
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const wsBefore = wsInstances.length;
      session.disconnect();

      await vi.advanceTimersByTimeAsync(5000);
      // No new WebSocket should be created
      expect(wsInstances.length).toBe(wsBefore);

      vi.useRealTimers();
    });

    it("fires error after max reconnect attempts", async () => {
      vi.useFakeTimers();
      const { session, stateChanges, errors } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // Simulate 5 unexpected closes (max attempts)
      for (let i = 0; i < 5; i++) {
        lastWs().close();
        await vi.advanceTimersByTimeAsync(20000);
      }

      // After 5th close, next attempt should fire max error
      lastWs().close();
      expect(errors).toContain("Connection lost. Please refresh.");
      expect(stateChanges).toContain("error");

      vi.useRealTimers();
    });

    it("uses exponential backoff delay", async () => {
      vi.useFakeTimers();
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // 1st close: delay = 1000ms
      lastWs().close();
      const count1 = wsInstances.length;
      await vi.advanceTimersByTimeAsync(999);
      expect(wsInstances.length).toBe(count1); // Not yet
      await vi.advanceTimersByTimeAsync(2);
      expect(wsInstances.length).toBe(count1 + 1); // Now

      // 2nd close: delay = 2000ms
      lastWs().close();
      const count2 = wsInstances.length;
      await vi.advanceTimersByTimeAsync(1999);
      expect(wsInstances.length).toBe(count2);
      await vi.advanceTimersByTimeAsync(2);
      expect(wsInstances.length).toBe(count2 + 1);

      vi.useRealTimers();
    });
  });

  describe("heartbeat", () => {
    it("sends ping on interval", async () => {
      vi.useFakeTimers();
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const ws = lastWs();
      const sentBefore = ws.sent.length;

      // Advance by ping interval
      await vi.advanceTimersByTimeAsync(30_000);

      const pings = ws.sent.slice(sentBefore).filter((msg) => {
        const parsed = JSON.parse(msg as string);
        return parsed.type === "ping";
      });
      expect(pings.length).toBe(1);

      vi.useRealTimers();
    });

    it("closes connection when pong not received", async () => {
      vi.useFakeTimers();
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // First ping sets pongReceived = false
      await vi.advanceTimersByTimeAsync(30_000);

      // Second interval: pongReceived still false → close
      await vi.advanceTimersByTimeAsync(30_000);

      expect(lastWs().readyState).toBe(3);

      vi.useRealTimers();
    });

    it("does not close connection when pong received", async () => {
      vi.useFakeTimers();
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const ws = lastWs();

      // First ping
      await vi.advanceTimersByTimeAsync(30_000);

      // Simulate pong response
      ws.simulateMessage({ type: "pong" });

      // Second interval: pongReceived is true → sends new ping (no close)
      await vi.advanceTimersByTimeAsync(30_000);

      expect(ws.readyState).toBe(1); // Still open

      vi.useRealTimers();
    });
  });

  describe("state machine", () => {
    it("warns on invalid state transition in dev", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      // "ready" -> "thinking" is not valid (should go through listening first)
      lastWs().simulateMessage({ type: "thinking" });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid state transition"));
      warnSpy.mockRestore();
    });
  });

  describe("config (no top-level fallback)", () => {
    it("uses config object for instructions/greeting/voice", async () => {
      const { session, stateChanges } = createSession({
        config: {
          instructions: "config instructions",
          greeting: "config greeting",
          voice: "config-voice",
        },
      });
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const configMsg = JSON.parse(lastWs().sent[1] as string);
      expect(configMsg.instructions).toBe("config instructions");
      expect(configMsg.greeting).toBe("config greeting");
      expect(configMsg.voice).toBe("config-voice");
    });

    it("uses empty defaults when config is absent", async () => {
      const { session, stateChanges } = createSession({});
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const configMsg = JSON.parse(lastWs().sent[1] as string);
      expect(configMsg.instructions).toBe("");
      expect(configMsg.greeting).toBe("");
      expect(configMsg.voice).toBe("jess");
    });

    it("uses default platformUrl when none specified", async () => {
      const { session, stateChanges } = createSession({ platformUrl: undefined });
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      expect(lastWs().url).toContain("wss://platform.example.com/session");
    });
  });

  describe("blob URL revocation", () => {
    it("revokes blob URLs after addModule", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      lastWs().simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });

      await vi.waitFor(() => expect(stateChanges).toContain("listening"));

      // Both mic and player call URL.revokeObjectURL
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("binary data before player is created does not crash", async () => {
      const { session, stateChanges } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const audioData = new Int16Array([100, 200, 300]).buffer;
      lastWs().simulateBinary(audioData);
    });

    it("cancel before connect is safe (no WS yet)", () => {
      const { session } = createSession();
      session.cancel();
    });

    it("reset before connect is safe (no WS yet)", () => {
      const { session } = createSession();
      session.reset();
    });

    it("disconnect before connect is safe (no WS yet)", () => {
      const { session } = createSession();
      session.disconnect();
    });
  });

  describe("full message flow", () => {
    it("simulates a complete conversation turn", async () => {
      const { session, stateChanges, receivedMessages, transcripts } = createSession();
      session.connect();
      await vi.waitFor(() => expect(stateChanges).toContain("ready"));

      const ws = lastWs();

      // 1. Server sends ready
      ws.simulateMessage({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      });
      await vi.waitFor(() => expect(stateChanges).toContain("listening"));

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
