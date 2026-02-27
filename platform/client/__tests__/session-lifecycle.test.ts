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
