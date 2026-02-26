import { vi } from "vitest";
import type { VoiceDeps } from "../src/types";

/** Create a VoiceDeps with vi.fn() stubs and sensible defaults. */
export function mockDeps(overrides: Partial<VoiceDeps> = {}): VoiceDeps {
  return {
    baseUrl: "http://test",
    autoGreet: false,
    bargeInMinChars: 20,
    enableBargeIn: true,
    maxMessages: 0,
    reconnect: true,
    maxReconnectAttempts: 3,
    fetchTimeout: 30000,
    sttConnect: vi.fn(),
    startCapture: vi.fn(),
    sttDisconnect: vi.fn(),
    sendClear: vi.fn(),
    readStream: vi.fn(),
    stopPlayback: vi.fn(),
    speakingRef: { current: false },
    ...overrides,
  };
}
