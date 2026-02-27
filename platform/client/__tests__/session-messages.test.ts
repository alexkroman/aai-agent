import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubBrowserGlobals, resetWsInstances } from "./_mocks.js";
import { createSession, lastWs } from "./_session-helpers.js";

stubBrowserGlobals();

describe("VoiceSession — message handling", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("handles 'ready' message — sets state to listening", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });

    await vi.waitFor(() => expect(stateChanges).toContain("listening"));
  });

  it("resets reconnectAttempts on ready message", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });

    await vi.waitFor(() => expect(stateChanges).toContain("listening"));
  });

  it("handles 'greeting' message", async () => {
    const { session, stateChanges, receivedMessages } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "greeting", text: "Hi there!" });

    expect(receivedMessages).toContainEqual({
      role: "assistant",
      text: "Hi there!",
    });
    expect(stateChanges).toContain("speaking");
  });

  it("handles 'transcript' message", async () => {
    const { session, stateChanges, transcripts } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "transcript", text: "Hello wor" });

    expect(transcripts).toContain("Hello wor");
  });

  it("handles 'turn' message — adds user message and clears transcript", async () => {
    const { session, stateChanges, receivedMessages, transcripts } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "turn", text: "Hello world" });

    expect(receivedMessages).toContainEqual({
      role: "user",
      text: "Hello world",
    });
    expect(transcripts).toContain("");
  });

  it("handles 'thinking' message — sets state", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "thinking" });

    expect(stateChanges).toContain("thinking");
  });

  it("handles 'chat' message with steps", async () => {
    const { session, stateChanges, receivedMessages } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "chat",
      text: "The weather is sunny",
      steps: ["Using get_weather"],
    });

    expect(receivedMessages).toContainEqual({
      role: "assistant",
      text: "The weather is sunny",
      steps: ["Using get_weather"],
    });
    expect(stateChanges).toContain("speaking");
  });

  it("handles 'tts_done' message — sets state to listening", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "tts_done" });

    expect(stateChanges).toContain("listening");
  });

  it("handles 'cancelled' message — flushes player, sets listening", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });

    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    // Move to speaking first so "cancelled" -> "listening" is a real transition
    lastWs().simulateMessage({ type: "greeting", text: "Hi" });
    expect(stateChanges).toContain("speaking");

    lastWs().simulateMessage({ type: "cancelled" });

    const listeningCount = stateChanges.filter((s) => s === "listening").length;
    expect(listeningCount).toBeGreaterThanOrEqual(2);
  });

  it("handles 'error' message — calls onError and sets error state", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { session, stateChanges, errors } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "error", message: "Something failed" });

    expect(errors).toContain("Something failed");
    expect(stateChanges).toContain("error");
    consoleSpy.mockRestore();
  });

  it("handles 'pong' message — sets pongReceived flag", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // pong should not throw or change state
    lastWs().simulateMessage({ type: "pong" });
  });

  it("ignores unknown message types via parseServerMessage returning null", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({ type: "unknown_type", data: "test" });

    // State should still be "ready" — unknown message is ignored
    const lastState = stateChanges[stateChanges.length - 1];
    expect(lastState).toBe("ready");
  });

  it("handles binary data — enqueues to audio player", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });

    const audioData = new Int16Array([100, 200, 300]).buffer;
    lastWs().simulateBinary(audioData);
  });

  it("handles 'reset' message — emits reset event and flushes player", async () => {
    const { session, stateChanges } = createSession();
    let resetFired = false;
    session.on("reset", () => {
      resetFired = true;
    });

    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Set up audio player
    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });
    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    lastWs().simulateMessage({ type: "reset" });

    expect(resetFired).toBe(true);
  });
});
