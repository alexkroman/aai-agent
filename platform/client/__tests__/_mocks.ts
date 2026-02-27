/**
 * Shared browser mocks for client tests.
 * Import and call stubBrowserGlobals() in each test file's top-level scope.
 */
import { vi } from "vitest";

// ── MockWebSocket ─────────────────────────────────────────────────

export const wsInstances: MockWebSocket[] = [];

export function resetWsInstances() {
  wsInstances.length = 0;
}

export class MockWebSocket {
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

  /** Test helper: simulate receiving a JSON message from server */
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Test helper: simulate receiving binary audio data */
  simulateBinary(buffer: ArrayBuffer) {
    this.onmessage?.({ data: buffer });
  }
}

// ── Audio mocks ───────────────────────────────────────────────────

export class MockAudioBuffer {
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

export class MockAudioBufferSource {
  buffer: unknown = null;
  connect = vi.fn();
  start = vi.fn();
}

export class MockAudioContext {
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
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

export class MockAudioWorkletNode {
  port = { postMessage: vi.fn(), onmessage: null as any };
  connect = vi.fn();
}

// ── stubBrowserGlobals ────────────────────────────────────────────

export const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [{ stop: vi.fn() }],
});

export function stubBrowserGlobals() {
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
}
