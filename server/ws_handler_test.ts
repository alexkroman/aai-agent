import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { handleSessionWebSocket, type Session } from "./ws_handler.ts";

class MockWs {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  sent: (string | ArrayBuffer | Uint8Array)[] = [];

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }

  open() {
    this.onopen?.(new Event("open"));
  }
  msg(data: string | ArrayBuffer) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  disconnect(code = 1000) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
  error() {
    this.onerror?.(new Event("error"));
  }

  sentJson(): Record<string, unknown>[] {
    return this.sent
      .filter((d): d is string => typeof d === "string")
      .map((s) => JSON.parse(s));
  }
}

function createSpySession(): Session & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start() {
      calls.push("start");
    },
    stop() {
      calls.push("stop");
      return Promise.resolve();
    },
    onAudioReady() {
      calls.push("onAudioReady");
    },
    onAudio(_data: Uint8Array) {
      calls.push("onAudio");
    },
    onCancel() {
      calls.push("onCancel");
    },
    onReset() {
      calls.push("onReset");
    },
  };
}

function setup(overrides?: { onOpen?: () => void; onClose?: () => void }) {
  const ws = new MockWs();
  const sessions = new Map<string, Session>();
  const spy = createSpySession();

  handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
    createSession: () => spy,
    ...overrides,
  });

  return { ws, sessions, spy };
}

describe("handleSessionWebSocket", () => {
  it("creates and starts session on open", async () => {
    const { ws, sessions, spy } = setup();
    ws.open();
    await new Promise((r) => setTimeout(r, 10));

    expect(sessions.size).toBe(1);
    expect(spy.calls).toContain("start");
  });

  it("calls onOpen/onClose callbacks", async () => {
    let openCalled = false;
    let closeCalled = false;
    const { ws } = setup({
      onOpen: () => {
        openCalled = true;
      },
      onClose: () => {
        closeCalled = true;
      },
    });

    ws.open();
    await new Promise((r) => setTimeout(r, 10));
    expect(openCalled).toBe(true);

    ws.disconnect();
    await new Promise((r) => setTimeout(r, 10));
    expect(closeCalled).toBe(true);
  });

  it("responds to ping with pong before session is ready", () => {
    const { ws } = setup();
    // Send before open — session not ready
    ws.msg(JSON.stringify({ type: "ping" }));
    expect(ws.sentJson().some((m) => m.type === "pong")).toBe(true);
  });

  it("responds to ping with pong after session is ready", async () => {
    const { ws } = setup();
    ws.open();
    await new Promise((r) => setTimeout(r, 10));

    ws.sent.length = 0;
    ws.msg(JSON.stringify({ type: "ping" }));
    expect(ws.sentJson().some((m) => m.type === "pong")).toBe(true);
  });

  it("queues control messages sent before open and replays them", async () => {
    const { ws, spy } = setup();
    ws.msg(JSON.stringify({ type: "audio_ready" }));
    ws.open();
    await new Promise((r) => setTimeout(r, 50));

    expect(spy.calls).toContain("start");
    expect(spy.calls).toContain("onAudioReady");
  });

  it("dispatches audio_ready, cancel, reset to session", async () => {
    const { ws, spy } = setup();
    ws.open();
    await new Promise((r) => setTimeout(r, 10));

    ws.msg(JSON.stringify({ type: "audio_ready" }));
    ws.msg(JSON.stringify({ type: "cancel" }));
    ws.msg(JSON.stringify({ type: "reset" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(spy.calls).toContain("onAudioReady");
    expect(spy.calls).toContain("onCancel");
    expect(spy.calls).toContain("onReset");
  });

  it("dispatches binary audio to session.onAudio", async () => {
    const { ws, spy } = setup();
    ws.open();
    await new Promise((r) => setTimeout(r, 10));

    ws.msg(new ArrayBuffer(16));
    expect(spy.calls).toContain("onAudio");
  });

  it("ignores invalid JSON and unknown control types", async () => {
    const { ws, spy } = setup();
    ws.open();
    await new Promise((r) => setTimeout(r, 10));

    const callsBefore = spy.calls.length;
    ws.msg("not json");
    ws.msg(JSON.stringify({ type: "bogus" }));
    await new Promise((r) => setTimeout(r, 10));

    // No new session method calls
    expect(spy.calls.length).toBe(callsBefore);
  });

  it("stops session and removes from map on close", async () => {
    const { ws, sessions, spy } = setup();
    ws.open();
    await new Promise((r) => setTimeout(r, 10));
    expect(sessions.size).toBe(1);

    ws.disconnect();
    await new Promise((r) => setTimeout(r, 10));
    expect(spy.calls).toContain("stop");
    expect(sessions.size).toBe(0);
  });

  it("handles ws error without crashing", () => {
    const { ws } = setup();
    ws.error();
    // No throw
  });
});
