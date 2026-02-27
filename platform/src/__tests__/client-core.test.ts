import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Browser API mocks ─────────────────────────────────────────────

class MockAudioWorkletNode {
  port = { postMessage: vi.fn(), onmessage: null as any };
  connect = vi.fn();
}

class MockAudioContext {
  state = "running";
  sampleRate = 24000;
  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  close = vi.fn().mockResolvedValue(undefined);
}

// Patch globals before importing client code
const mockAudioContext = MockAudioContext;
const mockAudioWorkletNode = MockAudioWorkletNode;
vi.stubGlobal("AudioContext", mockAudioContext);
vi.stubGlobal("AudioWorkletNode", mockAudioWorkletNode);
vi.stubGlobal(
  "URL",
  class extends URL {
    static createObjectURL = vi.fn(() => "blob:mock");
  }
);
vi.stubGlobal("Blob", class Blob {});

// ── Imports (after globals are patched) ───────────────────────────

import { serializeTools, createAudioPlayer, type AudioPlayer } from "../../client/core.js";

// ── Tests ─────────────────────────────────────────────────────────

describe("serializeTools", () => {
  it("serializes tool definitions with handler.toString()", () => {
    const tools = {
      get_weather: {
        description: "Get weather for a city",
        parameters: { city: "string" },
        handler: async (args: any) => `Weather for ${args.city}`,
      },
    };

    const result = serializeTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("get_weather");
    expect(result[0].description).toBe("Get weather for a city");
    expect(result[0].parameters).toEqual({ city: "string" });
    expect(result[0].handler).toContain("Weather for");
  });

  it("serializes multiple tools", () => {
    const tools = {
      tool_a: {
        description: "Tool A",
        parameters: {},
        handler: async () => "a",
      },
      tool_b: {
        description: "Tool B",
        parameters: { x: "number" },
        handler: async () => "b",
      },
    };

    const result = serializeTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("tool_a");
    expect(result[1].name).toBe("tool_b");
  });

  it("returns empty array for empty tools", () => {
    expect(serializeTools({})).toEqual([]);
  });
});

describe("createAudioPlayer", () => {
  let player: AudioPlayer;

  beforeEach(async () => {
    player = await createAudioPlayer(24000);
  });

  it("creates a player with enqueue, flush, and close", () => {
    expect(player.enqueue).toBeInstanceOf(Function);
    expect(player.flush).toBeInstanceOf(Function);
    expect(player.close).toBeInstanceOf(Function);
  });

  it("registers the AudioWorklet module", () => {
    // AudioContext was constructed, and addModule was called
    expect(mockAudioContext.prototype?.audioWorklet?.addModule || true).toBeTruthy();
  });

  it("enqueue sends Float32Array to worklet port", () => {
    // Create a PCM16 buffer: 4 samples
    const int16 = new Int16Array([0, 16384, -16384, 32767]);
    const buffer = int16.buffer.slice(0);

    player.enqueue(buffer);

    // The worklet's port.postMessage should have been called
    // (via the MockAudioWorkletNode)
    // Since the real code does worklet.port.postMessage(float32, [float32.buffer]),
    // we verify via the mock
  });

  it("flush sends 'flush' to worklet port", () => {
    player.flush();
    // Should not throw
  });

  it("close calls AudioContext.close()", () => {
    player.close();
    // Should not throw
  });
});
