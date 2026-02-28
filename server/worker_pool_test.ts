import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type AgentInfo,
  type AgentSlot,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";

const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
  ASSEMBLYAI_TTS_API_KEY: "test-tts-key",
};

function makeSlot(overrides?: Partial<AgentSlot>): AgentSlot {
  return {
    slug: "test",
    env: VALID_ENV,
    platformConfig: {
      apiKey: "k",
      ttsApiKey: "k",
      sttConfig: {} as AgentSlot["platformConfig"]["sttConfig"],
      ttsConfig: {} as AgentSlot["platformConfig"]["ttsConfig"],
      model: "m",
      llmGatewayBase: "https://example.com",
    },
    activeSessions: 0,
    ...overrides,
  };
}

function makeFakeAgent(slug = "test"): AgentInfo {
  return {
    slug,
    name: slug,
    worker: { terminate: () => {} } as unknown as Worker,
    workerApi: {} as AgentInfo["workerApi"],
    config: {} as AgentInfo["config"],
    toolSchemas: [],
  };
}

describe("registerSlot", () => {
  it("registers slot with valid env", () => {
    const slots = new Map<string, AgentSlot>();
    const ok = registerSlot(slots, { slug: "hello", env: VALID_ENV });
    expect(ok).toBe(true);
    expect(slots.has("hello")).toBe(true);
    expect(slots.get("hello")!.activeSessions).toBe(0);
  });

  it("returns false for invalid env", () => {
    const slots = new Map<string, AgentSlot>();
    const ok = registerSlot(slots, { slug: "bad", env: {} });
    expect(ok).toBe(false);
    expect(slots.has("bad")).toBe(false);
  });

  it("overwrites existing slot with same slug", () => {
    const slots = new Map<string, AgentSlot>();
    registerSlot(slots, { slug: "x", env: VALID_ENV });
    registerSlot(slots, { slug: "x", env: VALID_ENV });
    expect(slots.size).toBe(1);
  });
});

describe("trackSessionOpen", () => {
  it("increments activeSessions", () => {
    const slot = makeSlot();
    trackSessionOpen(slot);
    expect(slot.activeSessions).toBe(1);
    trackSessionOpen(slot);
    expect(slot.activeSessions).toBe(2);
  });

  it("clears idle timer", () => {
    const slot = makeSlot({ idleTimer: setTimeout(() => {}, 99999) });
    trackSessionOpen(slot);
    expect(slot.idleTimer).toBeUndefined();
  });
});

describe("trackSessionClose", () => {
  it("decrements activeSessions", () => {
    const slot = makeSlot({ activeSessions: 2 });
    trackSessionClose(slot, []);
    expect(slot.activeSessions).toBe(1);
  });

  it("does not go below zero", () => {
    const slot = makeSlot({ activeSessions: 0 });
    trackSessionClose(slot, []);
    expect(slot.activeSessions).toBe(0);
  });

  it("sets idle timer when last session closes and agent is live", () => {
    const agent = makeFakeAgent();
    const slot = makeSlot({ activeSessions: 1, live: agent });
    trackSessionClose(slot, [agent]);
    expect(slot.idleTimer).toBeDefined();
    // Clean up the timer
    clearTimeout(slot.idleTimer);
  });

  it("does not set idle timer when no live agent", () => {
    const slot = makeSlot({ activeSessions: 1 });
    trackSessionClose(slot, []);
    expect(slot.idleTimer).toBeUndefined();
  });
});
