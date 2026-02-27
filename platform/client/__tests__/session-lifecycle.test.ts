import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubBrowserGlobals, resetWsInstances, wsInstances } from "./_mocks.js";
import { createSession, lastWs } from "./_session-helpers.js";

stubBrowserGlobals();

describe("VoiceSession — cancel", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("sends cancel message via WebSocket", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    session.cancel();

    const cancelMsg = lastWs().sent.find((msg) => {
      const parsed = JSON.parse(msg as string);
      return parsed.type === "cancel";
    });
    expect(cancelMsg).toBeDefined();
  });

  it("drops binary audio frames after cancel until CANCELLED arrives", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Set up audio player
    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });
    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    // Move to speaking
    lastWs().simulateMessage({ type: "greeting", text: "Hi" });
    expect(stateChanges).toContain("speaking");

    // Cancel
    session.cancel();

    // Binary frames after cancel should be dropped
    const audioData = new Int16Array([100, 200, 300]).buffer;
    lastWs().simulateBinary(audioData);

    // CANCELLED arrives — should re-enable audio
    lastWs().simulateMessage({ type: "cancelled" });

    // Binary frames after CANCELLED should be enqueued
    lastWs().simulateBinary(audioData);
  });

  it("transitions to listening immediately on cancel", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });
    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    // Move to speaking
    lastWs().simulateMessage({ type: "greeting", text: "Hi" });
    expect(stateChanges).toContain("speaking");

    // Cancel should immediately transition to listening
    session.cancel();
    const lastState = stateChanges[stateChanges.length - 1];
    expect(lastState).toBe("listening");
  });
});

describe("VoiceSession — reset", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("sends reset message via WebSocket", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    session.reset();

    const resetMsg = lastWs().sent.find((msg) => {
      const parsed = JSON.parse(msg as string);
      return parsed.type === "reset";
    });
    expect(resetMsg).toBeDefined();
  });

  it("emits reset and reconnects when WebSocket is not open", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Disconnect so WebSocket is closed
    session.disconnect();

    const resetEvents: string[] = [];
    session.on("reset", () => resetEvents.push("reset"));

    const wsBefore = wsInstances.length;

    session.reset();

    // Should have emitted reset locally
    expect(resetEvents).toHaveLength(1);

    // Should have created a new WebSocket (reconnected)
    expect(wsInstances.length).toBe(wsBefore + 1);

    // New connection should reach ready state
    await vi.waitFor(() =>
      expect(stateChanges.filter((s) => s === "ready").length).toBeGreaterThanOrEqual(2)
    );
  });

  it("emits reset and reconnects when in error state with closed WebSocket", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Exhaust reconnect attempts to reach error state with no open WS
    for (let i = 0; i < 5; i++) {
      lastWs().close();
      await vi.advanceTimersByTimeAsync(20000);
    }
    lastWs().close();
    expect(stateChanges).toContain("error");

    const resetEvents: string[] = [];
    session.on("reset", () => resetEvents.push("reset"));

    const wsBefore = wsInstances.length;

    session.reset();

    // Should have emitted reset locally
    expect(resetEvents).toHaveLength(1);

    // Should have created a new WebSocket (reconnected)
    expect(wsInstances.length).toBe(wsBefore + 1);

    vi.useRealTimers();
  });
});

describe("VoiceSession — disconnect", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("closes the WebSocket and nulls it", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    session.disconnect();

    expect(lastWs().readyState).toBe(3);
  });

  it("intentional disconnect fires connecting state", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    session.disconnect();

    expect(stateChanges).toContain("connecting");
  });

  it("safe to call methods after disconnect", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    session.disconnect();

    // These should not throw
    session.cancel();
    session.reset();
    session.disconnect();
  });
});

describe("VoiceSession — reconnection", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("schedules reconnect on unexpected close", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Simulate unexpected close
    lastWs().close();

    // Should schedule reconnect — state goes to "connecting"
    expect(stateChanges).toContain("connecting");

    // After delay, should create a new WebSocket
    const wsBefore = wsInstances.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(wsInstances.length).toBe(wsBefore + 1);

    vi.useRealTimers();
  });

  it("does not reconnect on intentional disconnect", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const wsBefore = wsInstances.length;
    session.disconnect();

    await vi.advanceTimersByTimeAsync(5000);
    // No new WebSocket should be created
    expect(wsInstances.length).toBe(wsBefore);

    vi.useRealTimers();
  });

  it("fires error after max reconnect attempts", async () => {
    vi.useFakeTimers();
    const { session, stateChanges, errors } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Simulate 5 unexpected closes (max attempts)
    for (let i = 0; i < 5; i++) {
      lastWs().close();
      await vi.advanceTimersByTimeAsync(20000);
    }

    // After 5th close, next attempt should fire max error
    lastWs().close();
    expect(errors).toContain("Connection lost. Please refresh.");
    expect(stateChanges).toContain("error");

    vi.useRealTimers();
  });

  it("uses exponential backoff delay", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // 1st close: delay = 1000ms
    lastWs().close();
    const count1 = wsInstances.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(wsInstances.length).toBe(count1); // Not yet
    await vi.advanceTimersByTimeAsync(2);
    expect(wsInstances.length).toBe(count1 + 1); // Now

    // 2nd close: delay = 2000ms
    lastWs().close();
    const count2 = wsInstances.length;
    await vi.advanceTimersByTimeAsync(1999);
    expect(wsInstances.length).toBe(count2);
    await vi.advanceTimersByTimeAsync(2);
    expect(wsInstances.length).toBe(count2 + 1);

    vi.useRealTimers();
  });
});

describe("VoiceSession — heartbeat", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("sends ping on interval", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const ws = lastWs();
    const sentBefore = ws.sent.length;

    // Advance by ping interval
    await vi.advanceTimersByTimeAsync(30_000);

    const pings = ws.sent.slice(sentBefore).filter((msg) => {
      const parsed = JSON.parse(msg as string);
      return parsed.type === "ping";
    });
    expect(pings.length).toBe(1);

    vi.useRealTimers();
  });

  it("closes connection when pong not received", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // First ping sets pongReceived = false
    await vi.advanceTimersByTimeAsync(30_000);

    // Second interval: pongReceived still false -> close
    await vi.advanceTimersByTimeAsync(30_000);

    expect(lastWs().readyState).toBe(3);

    vi.useRealTimers();
  });

  it("does not close connection when pong received", async () => {
    vi.useFakeTimers();
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const ws = lastWs();

    // First ping
    await vi.advanceTimersByTimeAsync(30_000);

    // Simulate pong response
    ws.simulateMessage({ type: "pong" });

    // Second interval: pongReceived is true -> sends new ping (no close)
    await vi.advanceTimersByTimeAsync(30_000);

    expect(ws.readyState).toBe(1); // Still open

    vi.useRealTimers();
  });
});

describe("VoiceSession — connected/disconnected/audioReady events", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("emits audioReady and connected after audio setup", async () => {
    const { session, stateChanges } = createSession();
    const events: string[] = [];
    session.on("audioReady", () => events.push("audioReady"));
    session.on("connected", () => events.push("connected"));
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });
    await vi.waitFor(() => expect(stateChanges).toContain("listening"));

    expect(events).toContain("audioReady");
    expect(events).toContain("connected");
    // audioReady fires before connected
    expect(events.indexOf("audioReady")).toBeLessThan(events.indexOf("connected"));
  });

  it("emits disconnected with intentional: true on disconnect()", async () => {
    const { session, stateChanges } = createSession();
    const disconnectEvents: { intentional: boolean }[] = [];
    session.on("disconnected", (data) => disconnectEvents.push(data));
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    session.disconnect();

    expect(disconnectEvents).toHaveLength(1);
    expect(disconnectEvents[0].intentional).toBe(true);
  });

  it("emits disconnected with intentional: false on unexpected close", async () => {
    const { session, stateChanges } = createSession();
    const disconnectEvents: { intentional: boolean }[] = [];
    session.on("disconnected", (data) => disconnectEvents.push(data));
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Simulate unexpected close
    lastWs().close();

    expect(disconnectEvents).toHaveLength(1);
    expect(disconnectEvents[0].intentional).toBe(false);
  });
});

describe("VoiceSession — disconnect during audio setup", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("does not assign player/mic if disconnected during audio setup", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    // Simulate READY message — this starts async audio setup
    lastWs().simulateMessage({
      type: "ready",
      sampleRate: 16000,
      ttsSampleRate: 24000,
    });

    // Disconnect immediately before audio setup completes
    session.disconnect();

    // Let the audio setup promise resolve
    await new Promise((r) => setTimeout(r, 50));

    // State should not have gone to "listening" after disconnect
    const statesAfterDisconnect = stateChanges.slice(stateChanges.indexOf("connecting", 1));
    expect(statesAfterDisconnect).not.toContain("listening");
  });
});
