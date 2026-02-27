import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubBrowserGlobals, resetWsInstances } from "./_mocks.js";
import { createSession, lastWs } from "./_session-helpers.js";

stubBrowserGlobals();

describe("VoiceSession — state machine", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("warns on invalid state transition in dev", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // "ready" -> "thinking" is not valid (should go through listening first)
    lastWs().simulateMessage({ type: "thinking" });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid state transition"));
    warnSpy.mockRestore();
  });
});

describe("VoiceSession — blob URL revocation", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("revokes blob URLs after addModule", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });

    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    // Both mic and player call URL.revokeObjectURL
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("VoiceSession — edge cases", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("binary data before player is created does not crash", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const audioData = new Int16Array([100, 200, 300]).buffer;
    lastWs().simulateBinary(audioData);
  });

  it("cancel before connect is safe (no WS yet)", () => {
    const { session } = createSession();
    session.cancel();
  });

  it("reset before connect is safe (no WS yet)", () => {
    const { session } = createSession();
    session.reset();
  });

  it("disconnect before connect is safe (no WS yet)", () => {
    const { session } = createSession();
    session.disconnect();
  });
});

describe("VoiceSession — full message flow", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("simulates a complete conversation turn", async () => {
    const { session, stateChanges, receivedMessages, transcripts } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const ws = lastWs();

    // 1. Server sends ready
    ws.simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });
    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    // 2. Server sends greeting
    ws.simulateMessage({ type: "greeting", text: "Hello!" });
    expect(receivedMessages[0]).toEqual({
      role: "assistant",
      text: "Hello!",
    });

    // 3. Server sends partial transcript
    ws.simulateMessage({ type: "transcript", text: "What's the" });
    expect(transcripts).toContain("What's the");

    // 4. Server sends completed turn
    ws.simulateMessage({ type: "turn", text: "What's the weather?" });
    expect(receivedMessages).toContainEqual({
      role: "user",
      text: "What's the weather?",
    });

    // 5. Server sends thinking
    ws.simulateMessage({ type: "thinking" });
    expect(stateChanges).toContain("thinking");

    // 6. Server sends chat response
    ws.simulateMessage({
      type: "chat",
      text: "It's sunny!",
      steps: ["Using get_weather"],
    });
    expect(receivedMessages).toContainEqual({
      role: "assistant",
      text: "It's sunny!",
      steps: ["Using get_weather"],
    });
    expect(stateChanges).toContain("speaking");

    // 7. TTS done
    ws.simulateMessage({ type: "tts_done" });
    expect(stateChanges[stateChanges.length - 1]).toBe("listening");
  });
});
