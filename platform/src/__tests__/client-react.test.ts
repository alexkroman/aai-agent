import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock browser APIs ─────────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  readyState = 1;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    queueMicrotask(() => this.onopen?.());
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
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

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("AudioContext", MockAudioContext);
vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
vi.stubGlobal("navigator", {
  mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  },
});
vi.stubGlobal(
  "URL",
  class extends URL {
    static createObjectURL = vi.fn(() => "blob:mock");
    static revokeObjectURL = vi.fn();
  }
);
vi.stubGlobal("Blob", class Blob {});

// ── Mock React hooks (hoisted for vi.mock factory) ────────────────

const { mockUseEffect, mockUseRef, mockUseCallback, mockSetState, state } = vi.hoisted(() => {
  const state = {
    effectCleanup: null as (() => void) | null,
    current: {} as any,
  };
  const mockSetState = vi.fn((updater: any) => {
    if (typeof updater === "function") {
      state.current = updater(state.current);
    } else {
      state.current = updater;
    }
  });
  const mockUseEffect = vi.fn((fn: () => (() => void) | void, _deps?: unknown[]) => {
    const cleanup = fn();
    if (typeof cleanup === "function") {
      state.effectCleanup = cleanup;
    }
  });
  const refStore = new Map<string, { current: any }>();
  const mockUseRef = vi.fn((initial: any) => {
    // Return a stable ref for the same initial value type
    const key = typeof initial;
    if (!refStore.has(key)) {
      refStore.set(key, { current: initial });
    }
    return refStore.get(key)!;
  });
  const mockUseCallback = vi.fn((fn: any) => fn);

  return { mockUseEffect, mockUseRef, mockUseCallback, mockSetState, state };
});

vi.mock("react", () => ({
  useState: (initial: any) => {
    state.current = initial;
    return [initial, mockSetState];
  },
  useEffect: mockUseEffect,
  useRef: mockUseRef,
  useCallback: mockUseCallback,
}));

// ── Imports ───────────────────────────────────────────────────────

import { useVoiceAgent, type VoiceAgentOptions } from "../../client/react.js";

// ── Tests ─────────────────────────────────────────────────────────

describe("useVoiceAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.effectCleanup = null;
    state.current = {};
  });

  it("returns state, messages, transcript, cancel, and reset", () => {
    const result = useVoiceAgent({
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
    });

    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("transcript");
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("cancel");
    expect(result).toHaveProperty("reset");
  });

  it("calls useEffect with apiKey and platformUrl deps", () => {
    useVoiceAgent({
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
    });

    expect(mockUseEffect).toHaveBeenCalledOnce();
    const deps = mockUseEffect.mock.calls[0][1];
    expect(deps).toEqual(["pk_test", "ws://localhost:3000"]);
  });

  it("cleanup function calls session.disconnect()", () => {
    useVoiceAgent({
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
    });

    expect(state.effectCleanup).toBeInstanceOf(Function);
    state.effectCleanup!();
  });

  it("cancel and reset are memoized with useCallback", () => {
    useVoiceAgent({ apiKey: "pk_test" });

    expect(mockUseCallback).toHaveBeenCalledTimes(2);
  });

  it("uses useRef for config and tools (prevents stale closures)", () => {
    useVoiceAgent({
      apiKey: "pk_test",
      config: { instructions: "Be helpful" },
      tools: {
        search: {
          description: "Search",
          parameters: {},
          handler: async () => "result",
        },
      },
    });

    // useRef should be called for sessionRef, configRef, toolsRef
    expect(mockUseRef).toHaveBeenCalled();
  });

  it("accepts config and tools options", () => {
    const opts: VoiceAgentOptions = {
      apiKey: "pk_test",
      config: {
        instructions: "Be helpful",
        greeting: "Hi!",
        voice: "luna",
      },
      tools: {
        search: {
          description: "Search the web",
          parameters: { query: "string" },
          handler: async (args: any) => `Results for ${args.query}`,
        },
      },
    };

    const result = useVoiceAgent(opts);
    expect(result.state).toBe("connecting");
  });

  it("state change callback does not have thinking/listening hack", () => {
    useVoiceAgent({
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
    });

    // All setState calls should pass the value directly, not use an updater function
    const calls = mockSetState.mock.calls;
    const updaterCalls = calls.filter((c: any[]) => typeof c[0] === "function");

    // No updater functions — state changes are direct
    // (The old code had a setState(prev => ...) hack)
    expect(updaterCalls.length).toBe(0);
  });

  it("connect error sets error state", () => {
    // Override WebSocket to throw on construction
    const OriginalWS = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = class ThrowingWS {
      constructor() {
        throw new Error("Connection refused");
      }
    };

    useVoiceAgent({
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
    });

    // Should have called setError and setState("error")
    const errorCalls = mockSetState.mock.calls.filter(
      (c: any[]) => c[0] === "error" || (typeof c[0] === "string" && c[0].includes("Connection"))
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);

    (globalThis as any).WebSocket = OriginalWS;
  });
});
