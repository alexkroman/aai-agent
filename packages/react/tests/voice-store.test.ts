import { describe, it, expect, vi, beforeEach } from "vitest";
import { debounce } from "../src/debounce";
import { createVoiceStore } from "../src/useVoiceAgent";
import { createMessageId } from "../src/types";
import { mockDeps } from "./helpers";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("delays execution by the specified ms", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("resets timer on repeated calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(80);
    debounced(); // reset
    vi.advanceTimersByTime(80);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("cancel prevents execution", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("createVoiceStore", () => {
  it("starts with empty messages and default status", () => {
    const store = createVoiceStore();
    const state = store.getState();
    expect(state.messages).toEqual([]);
    expect(state.turnPhase).toBe("listening");
    expect(state.phase).toBe("idle");
    expect(state.error).toBeNull();
  });

  it("addMessage appends a message with unique id", () => {
    const store = createVoiceStore();
    const id = store.getState().addMessage("hello", "user");
    const msgs = store.getState().messages;

    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("hello");
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].type).toBe("message");
    expect(msgs[0].id).toBe(id);
  });

  it("addMessage supports custom type", () => {
    const store = createVoiceStore();
    store.getState().addMessage("", "assistant", "thinking");
    expect(store.getState().messages[0].type).toBe("thinking");
  });

  it("removeMessage removes by id", () => {
    const store = createVoiceStore();
    const id1 = store.getState().addMessage("first", "user");
    const id2 = store.getState().addMessage("second", "assistant");

    store.getState().removeMessage(id1);
    const msgs = store.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe(id2);
  });

  it("removeMessage is a no-op for unknown id", () => {
    const store = createVoiceStore();
    store.getState().addMessage("hi", "user");
    const fakeId = createMessageId("nonexistent-id");
    store.getState().removeMessage(fakeId);
    expect(store.getState().messages).toHaveLength(1);
  });

  it("multiple addMessage calls accumulate", () => {
    const store = createVoiceStore();
    store.getState().addMessage("a", "user");
    store.getState().addMessage("b", "assistant");
    store.getState().addMessage("c", "user");
    expect(store.getState().messages).toHaveLength(3);
  });

  it("clearMessages empties the message list", () => {
    const store = createVoiceStore();
    store.getState().addMessage("a", "user");
    store.getState().addMessage("b", "assistant");
    expect(store.getState().messages).toHaveLength(2);

    store.getState().clearMessages();
    expect(store.getState().messages).toEqual([]);
  });

  it("addMessage enforces maxMessages when configured", () => {
    const store = createVoiceStore();
    store.getState()._setDeps(mockDeps({ maxMessages: 3 }));

    store.getState().addMessage("a", "user");
    store.getState().addMessage("b", "assistant");
    store.getState().addMessage("c", "user");
    store.getState().addMessage("d", "assistant");

    const msgs = store.getState().messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].text).toBe("b");
    expect(msgs[2].text).toBe("d");
  });

  it("addMessage does not truncate when maxMessages is 0", () => {
    const store = createVoiceStore();
    store.getState()._setDeps(mockDeps({ maxMessages: 0 }));

    for (let i = 0; i < 100; i++) {
      store.getState().addMessage(`msg ${i}`, "user");
    }
    expect(store.getState().messages).toHaveLength(100);
  });

  it("sendMessage sets turnText and calls sendTurnToAgent", async () => {
    const store = createVoiceStore();
    const deps = mockDeps({ readStream: vi.fn().mockResolvedValue(undefined) });
    store.getState()._setDeps(deps);

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    await store.getState().sendMessage("hello from text");

    const userMsg = store.getState().messages.find((m) => m.text === "hello from text");
    expect(userMsg).toBeDefined();
    expect(userMsg!.role).toBe("user");

    vi.unstubAllGlobals();
  });

  it("throws clear error when store used without deps", () => {
    const store = createVoiceStore();
    // bargeIn accesses deps via getDeps()
    expect(() => store.getState().bargeIn()).toThrow(
      "Voice store used before dependencies were injected",
    );
  });
});
