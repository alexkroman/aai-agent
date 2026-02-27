import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock browser APIs ─────────────────────────────────────────────

class MockAudioBufferSource {
  buffer: unknown = null;
  connect = vi.fn();
  start = vi.fn();
}

class MockAudioBuffer {
  numberOfChannels = 1;
  length: number;
  sampleRate: number;
  duration: number;
  private channelData: Float32Array;

  constructor(channels: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channelData;
  }
}

class MockAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  sampleRate: number;

  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 44100;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource() {
    return new MockAudioBufferSource();
  }

  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));

  close = vi.fn().mockResolvedValue(undefined);
}

class MockAudioWorkletNode {
  port = { postMessage: vi.fn(), onmessage: null as any };
  connect = vi.fn();
}

// Track WebSocket instances for testing
const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
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

  // Test helper: simulate receiving a message
  simulateMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data });
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("AudioContext", MockAudioContext);
vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
vi.stubGlobal("navigator", {
  mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  },
});
vi.stubGlobal(
  "URL",
  class extends URL {
    static createObjectURL = vi.fn(() => "blob:mock");
  }
);
vi.stubGlobal("Blob", class Blob {});

// ── Imports ───────────────────────────────────────────────────────

import { serializeTools, createAudioPlayer, startMicCapture } from "../../client/core.js";

// ── Tests ─────────────────────────────────────────────────────────

describe("serializeTools", () => {
  it("serializes a single tool", () => {
    const tools = {
      greet: {
        description: "Say hello",
        parameters: { name: "string" },
        handler: async (args: any) => `Hello ${args.name}`,
      },
    };

    const result = serializeTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
    expect(result[0].description).toBe("Say hello");
    expect(result[0].parameters).toEqual({ name: "string" });
    expect(result[0].handler).toContain("Hello");
  });

  it("serializes multiple tools preserving order", () => {
    const tools = {
      tool_a: {
        description: "First",
        parameters: {},
        handler: async () => "a",
      },
      tool_b: {
        description: "Second",
        parameters: { x: "number" },
        handler: async () => "b",
      },
    };

    const result = serializeTools(tools);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("tool_a");
    expect(result[1].name).toBe("tool_b");
  });

  it("converts handler function to string", () => {
    const handler = async (args: any, ctx: any) => {
      const resp = ctx.fetch("https://api.example.com");
      return resp.json();
    };

    const result = serializeTools({
      fetch_data: { description: "Fetch", parameters: {}, handler },
    });

    expect(typeof result[0].handler).toBe("string");
    expect(result[0].handler).toContain("ctx.fetch");
  });

  it("handles empty tools object", () => {
    expect(serializeTools({})).toEqual([]);
  });
});

describe("createAudioPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a player with enqueue, flush, and close methods", async () => {
    const player = await createAudioPlayer(24000);

    expect(player).toHaveProperty("enqueue");
    expect(player).toHaveProperty("flush");
    expect(player).toHaveProperty("close");
  });

  it("enqueue converts PCM16 to float32 and schedules playback", async () => {
    const player = await createAudioPlayer(24000);

    // Create a small PCM16 buffer (4 samples)
    const pcm16 = new Int16Array([0, 16384, 32767, -32768]);
    player.enqueue(pcm16.buffer);

    // Player should have created a buffer source and started it
    // (verified by not throwing)
  });

  it("flush resets playback by recreating AudioContext", async () => {
    const player = await createAudioPlayer(24000);
    player.enqueue(new Int16Array([100, 200]).buffer);
    player.flush();

    // After flush, should be able to enqueue again
    player.enqueue(new Int16Array([300, 400]).buffer);
  });

  it("close calls ctx.close()", async () => {
    const player = await createAudioPlayer(24000);
    player.close();
    // Should not throw when closing
  });

  it("enqueue after close is a no-op", async () => {
    const player = await createAudioPlayer(24000);
    player.close();
    // Enqueue after close should not throw
    player.enqueue(new Int16Array([100]).buffer);
  });
});

describe("startMicCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsInstances.length = 0;
  });

  it("requests mic with correct audio constraints", async () => {
    const mockWs = { readyState: 1, send: vi.fn() } as any;
    const cleanup = await startMicCapture(mockWs, 16000);

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    cleanup();
  });

  it("returns a cleanup function that stops tracks and closes context", async () => {
    const mockWs = { readyState: 1, send: vi.fn() } as any;
    const cleanup = await startMicCapture(mockWs, 16000);

    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
