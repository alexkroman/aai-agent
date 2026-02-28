import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RECONNECT_ATTEMPTS,
  MIC_BUFFER_SECONDS,
  PING_INTERVAL_MS,
  VALID_TRANSITIONS,
} from "../types.ts";
import type { AgentState } from "../types.ts";

describe("VALID_TRANSITIONS", () => {
  const allStates: AgentState[] = [
    "connecting",
    "ready",
    "listening",
    "thinking",
    "speaking",
    "error",
  ];

  it("has entries for all AgentState values", () => {
    for (const state of allStates) {
      expect(VALID_TRANSITIONS[state]).toBeDefined();
      expect(VALID_TRANSITIONS[state]).toBeInstanceOf(Set);
    }
  });

  it("connecting can transition to ready and error", () => {
    expect(VALID_TRANSITIONS.connecting.has("ready")).toBe(true);
    expect(VALID_TRANSITIONS.connecting.has("error")).toBe(true);
  });

  it("ready can transition to listening and error", () => {
    expect(VALID_TRANSITIONS.ready.has("listening")).toBe(true);
    expect(VALID_TRANSITIONS.ready.has("error")).toBe(true);
  });

  it("listening can transition to thinking, speaking, error", () => {
    expect(VALID_TRANSITIONS.listening.has("thinking")).toBe(true);
    expect(VALID_TRANSITIONS.listening.has("speaking")).toBe(true);
    expect(VALID_TRANSITIONS.listening.has("error")).toBe(true);
  });

  it("error can transition to connecting and ready", () => {
    expect(VALID_TRANSITIONS.error.has("connecting")).toBe(true);
    expect(VALID_TRANSITIONS.error.has("ready")).toBe(true);
  });

  it("no state can transition to itself", () => {
    for (const state of allStates) {
      expect(VALID_TRANSITIONS[state].has(state)).toBe(false);
    }
  });
});

describe("constants", () => {
  it("PING_INTERVAL_MS is a positive number", () => {
    expect(PING_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("MAX_RECONNECT_ATTEMPTS is a positive number", () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBeGreaterThan(0);
  });

  it("MAX_BACKOFF_MS is a positive number", () => {
    expect(MAX_BACKOFF_MS).toBeGreaterThan(0);
  });

  it("INITIAL_BACKOFF_MS is a positive number", () => {
    expect(INITIAL_BACKOFF_MS).toBeGreaterThan(0);
  });

  it("MIC_BUFFER_SECONDS is a positive number", () => {
    expect(MIC_BUFFER_SECONDS).toBeGreaterThan(0);
  });

  it("MAX_BACKOFF_MS is greater than INITIAL_BACKOFF_MS", () => {
    expect(MAX_BACKOFF_MS).toBeGreaterThan(INITIAL_BACKOFF_MS);
  });
});
