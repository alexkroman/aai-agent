import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type AgentState,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  VALID_TRANSITIONS,
} from "./types.ts";

const ALL_STATES: AgentState[] = [
  "connecting",
  "ready",
  "listening",
  "thinking",
  "speaking",
  "error",
];

describe("VALID_TRANSITIONS", () => {
  it("covers every state", () => {
    for (const state of ALL_STATES) {
      expect(VALID_TRANSITIONS[state]).toBeInstanceOf(Set);
    }
  });

  it("no state transitions to itself", () => {
    for (const state of ALL_STATES) {
      expect(VALID_TRANSITIONS[state].has(state)).toBe(false);
    }
  });

  it("error recovers to connecting or ready", () => {
    expect(VALID_TRANSITIONS.error).toEqual(new Set(["connecting", "ready"]));
  });

  it("every non-error state can reach error", () => {
    for (const state of ALL_STATES) {
      if (state !== "error") {
        expect(VALID_TRANSITIONS[state].has("error")).toBe(true);
      }
    }
  });
});

describe("backoff constants", () => {
  it("max backoff exceeds initial", () => {
    expect(MAX_BACKOFF_MS).toBeGreaterThan(INITIAL_BACKOFF_MS);
  });
});
