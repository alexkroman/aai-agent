import { describe, it, expect, vi } from "vitest";
import { createVoiceStore } from "../src/useVoiceAgent";
import { mockDeps } from "./helpers";

/**
 * Tests for handleAAIMessage logic (barge-in gating, turn formatting).
 * Uses the real createVoiceStore with mock deps injected.
 * Barge-in is detected via the onBargeIn lifecycle callback.
 */
function createTestStore({
  bargeInMinChars = 20,
  speakingCurrent = false,
  enableBargeIn = true,
} = {}) {
  const onBargeIn = vi.fn();
  const store = createVoiceStore();

  store.getState()._setDeps(
    mockDeps({
      bargeInMinChars,
      enableBargeIn,
      speakingRef: { current: speakingCurrent },
      onBargeIn,
    }),
  );

  return { store, onBargeIn };
}

describe("handleAAIMessage", () => {
  it("ignores non-Turn messages", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: true });
    store.getState().handleAAIMessage({ type: "Transcript", transcript: "hello world hello world" });
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it("ignores Turn messages with empty transcript", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: true });
    store.getState().handleAAIMessage({ type: "Turn", transcript: "   " });
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it("ignores Turn messages with no transcript", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: true });
    store.getState().handleAAIMessage({ type: "Turn" });
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it("does not barge in when not speaking", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: false });
    store.getState().handleAAIMessage({
      type: "Turn",
      transcript: "this is a long enough transcript to trigger barge in",
      turn_is_formatted: true,
    });
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it("does not barge in when transcript is too short", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: true, bargeInMinChars: 20 });
    store.getState().handleAAIMessage({
      type: "Turn",
      transcript: "short",
      turn_is_formatted: true,
    });
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it("barges in when speaking and transcript meets min chars", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: true, bargeInMinChars: 10 });
    store.getState().handleAAIMessage({
      type: "Turn",
      transcript: "this is long enough",
      turn_is_formatted: true,
    });
    expect(onBargeIn).toHaveBeenCalledOnce();
    expect(store.getState().statusClass).toBe("listening");
  });

  it("does not trigger debouncedSend when turn_is_formatted is false", () => {
    const { store } = createTestStore();
    store.getState().handleAAIMessage({
      type: "Turn",
      transcript: "partial",
      turn_is_formatted: false,
    });
  });

  it("bargeInMinChars=0 means barge in on any text while speaking", () => {
    const { store, onBargeIn } = createTestStore({ speakingCurrent: true, bargeInMinChars: 0 });
    store.getState().handleAAIMessage({
      type: "Turn",
      transcript: "a",
      turn_is_formatted: true,
    });
    expect(onBargeIn).toHaveBeenCalledOnce();
  });

  it("does not barge in when enableBargeIn is false", () => {
    const { store, onBargeIn } = createTestStore({
      speakingCurrent: true,
      bargeInMinChars: 10,
      enableBargeIn: false,
    });
    store.getState().handleAAIMessage({
      type: "Turn",
      transcript: "this is long enough to barge in",
      turn_is_formatted: true,
    });
    expect(onBargeIn).not.toHaveBeenCalled();
  });
});
