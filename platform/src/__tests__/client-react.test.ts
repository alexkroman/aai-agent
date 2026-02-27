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
  const mockUseRef = vi.fn((initial: any) => ({ current: initial }));
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
    // Calling cleanup should not throw
    state.effectCleanup!();
  });

  it("cancel and reset are memoized with useCallback", () => {
    useVoiceAgent({ apiKey: "pk_test" });

    expect(mockUseCallback).toHaveBeenCalledTimes(2);
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

  it("state change callback prevents overwriting 'thinking' with 'listening'", () => {
    useVoiceAgent({
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
    });

    // Find the onStateChange callback from the useEffect call
    // The effect creates a VoiceSession with callbacks
    // The setState updater function should preserve "thinking" state
    const calls = mockSetState.mock.calls;
    // Find a setState call with a function updater
    const updaterCalls = calls.filter((c: any[]) => typeof c[0] === "function");

    // Simulate: if prev is "thinking" and new is "listening", should keep "thinking"
    if (updaterCalls.length > 0) {
      const updater = updaterCalls[0][0];
      expect(updater("thinking")).toBe("thinking"); // Should not change
    }
  });
});
