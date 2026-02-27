import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubBrowserGlobals, resetWsInstances } from "./_mocks.js";

stubBrowserGlobals();

import { serializeTools, createAudioPlayer, startMicCapture, toWebSocketUrl } from "../core.js";

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

  it("revokes blob URL after addModule", async () => {
    await createAudioPlayer(24000);

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("enqueue converts PCM16 to float32 and schedules playback", async () => {
    const player = await createAudioPlayer(24000);

    const pcm16 = new Int16Array([0, 16384, 32767, -32768]);
    player.enqueue(pcm16.buffer);
  });

  it("flush resets playback by recreating AudioContext", async () => {
    const player = await createAudioPlayer(24000);
    player.enqueue(new Int16Array([100, 200]).buffer);
    player.flush();

    player.enqueue(new Int16Array([300, 400]).buffer);
  });

  it("close calls ctx.close()", async () => {
    const player = await createAudioPlayer(24000);
    player.close();
  });

  it("enqueue after close is a no-op", async () => {
    const player = await createAudioPlayer(24000);
    player.close();
    player.enqueue(new Int16Array([100]).buffer);
  });
});

describe("toWebSocketUrl", () => {
  it("converts http:// to ws://", () => {
    expect(toWebSocketUrl("http://localhost:3000")).toBe("ws://localhost:3000");
  });

  it("converts https:// to wss://", () => {
    expect(toWebSocketUrl("https://my-platform.com")).toBe("wss://my-platform.com");
  });

  it("passes through ws:// unchanged", () => {
    expect(toWebSocketUrl("ws://localhost:3000")).toBe("ws://localhost:3000");
  });

  it("passes through wss:// unchanged", () => {
    expect(toWebSocketUrl("wss://platform.example.com")).toBe("wss://platform.example.com");
  });

  it("preserves path and query string", () => {
    expect(toWebSocketUrl("http://host:3000/path?key=val")).toBe("ws://host:3000/path?key=val");
  });

  it("returns unknown schemes unchanged", () => {
    expect(toWebSocketUrl("ftp://host")).toBe("ftp://host");
  });
});

describe("startMicCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWsInstances();
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

  it("revokes blob URL after addModule", async () => {
    const mockWs = { readyState: 1, send: vi.fn() } as any;
    const cleanup = await startMicCapture(mockWs, 16000);

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");

    cleanup();
  });

  it("returns a cleanup function that stops tracks and closes context", async () => {
    const mockWs = { readyState: 1, send: vi.fn() } as any;
    const cleanup = await startMicCapture(mockWs, 16000);

    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("does not send audio when WS is not OPEN", async () => {
    const mockWs = { readyState: 3, send: vi.fn() } as any;
    const cleanup = await startMicCapture(mockWs, 16000);

    cleanup();
  });

  it("uses custom sample rate", async () => {
    const mockWs = { readyState: 1, send: vi.fn() } as any;
    const cleanup = await startMicCapture(mockWs, 8000);

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ sampleRate: 8000 }),
      })
    );

    cleanup();
  });
});
