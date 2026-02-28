import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { handleSessionWebSocket } from "../ws-handler.ts";
import { ServerSession } from "../session.ts";
import { MSG } from "../../sdk/shared-protocol.ts";
import type { AgentConfig } from "../../sdk/types.ts";
import { createMockSessionDeps } from "./_test-utils.ts";

/** Minimal mock WebSocket that simulates the server-side WS API. */
class MockServerWs {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  readyState = 1; // OPEN
  sent: (string | ArrayBuffer | Uint8Array)[] = [];

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }

  // Helpers to simulate events
  simulateOpen() {
    this.onopen?.(new Event("open"));
  }
  simulateMessage(data: string | ArrayBuffer, _isBinary = false) {
    // Real WebSocket MessageEvent has data property
    const event = new MessageEvent("message", { data });
    this.onmessage?.(event);
  }
  simulateClose(code = 1000) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
  simulateError() {
    this.onerror?.(new Event("error"));
  }
}

function createTestSession(
  _sessionId: string,
  ws: WebSocket,
): { session: ServerSession; agentConfig: AgentConfig } {
  const mocks = createMockSessionDeps();
  const agentConfig: AgentConfig = {
    instructions: "Test",
    greeting: "Hello!",
    voice: "jess",
  };
  const session = new ServerSession(
    _sessionId,
    ws,
    agentConfig,
    [],
    mocks.deps,
  );
  return { session, agentConfig };
}

describe("handleSessionWebSocket", () => {
  it("creates session and starts it on ws.onopen", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();
    let createCalled = false;

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (sessionId, wsArg) => {
        createCalled = true;
        return createTestSession(sessionId, wsArg);
      },
    });

    await ws.simulateOpen();
    // Wait for async onopen to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(createCalled).toBe(true);
    expect(sessions.size).toBe(1);
  });

  it("calls onOpen/onClose callbacks", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();
    let openCalled = false;
    let closeCalled = false;

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
      onOpen: () => {
        openCalled = true;
      },
      onClose: () => {
        closeCalled = true;
      },
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));
    expect(openCalled).toBe(true);

    await ws.simulateClose();
    await new Promise((r) => setTimeout(r, 10));
    expect(closeCalled).toBe(true);
  });

  it("responds to ping with pong before session is ready", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    // Send ping before onopen (session not ready yet)
    ws.simulateMessage(JSON.stringify({ type: MSG.PING }));
    await new Promise((r) => setTimeout(r, 10));

    // Should have responded with pong
    const pongs = ws.sent
      .filter((d): d is string => typeof d === "string")
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === MSG.PONG);
    expect(pongs.length).toBe(1);
  });

  it("queues non-ping messages before session is ready", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();
    let sessionRef: ServerSession | null = null;

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => {
        const result = createTestSession(id, wsArg);
        sessionRef = result.session;
        return result;
      },
    });

    // Send control message before onopen
    ws.simulateMessage(JSON.stringify({ type: "audio_ready" }));

    // Now open — queued messages should be replayed
    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 50));

    // Session was created and started
    expect(sessionRef).not.toBeNull();
  });

  it("handles ping/pong after session is ready", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));

    ws.sent.length = 0; // clear sent messages from session.start()
    ws.simulateMessage(JSON.stringify({ type: MSG.PING }));
    await new Promise((r) => setTimeout(r, 10));

    const pongs = ws.sent
      .filter((d): d is string => typeof d === "string")
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === MSG.PONG);
    expect(pongs.length).toBe(1);
  });

  it("handles binary audio after session is ready", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));

    // Send binary audio — should not throw
    const audioData = new ArrayBuffer(16);
    ws.simulateMessage(audioData);
    await new Promise((r) => setTimeout(r, 10));
    // No error means it was handled
  });

  it("handles control messages (cancel, reset) after session is ready", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));

    // Send cancel
    ws.simulateMessage(JSON.stringify({ type: "cancel" }));
    await new Promise((r) => setTimeout(r, 10));

    // Send reset
    ws.simulateMessage(JSON.stringify({ type: "reset" }));
    await new Promise((r) => setTimeout(r, 10));
  });

  it("ignores invalid JSON messages", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));

    // Send unparseable JSON — should not throw
    ws.simulateMessage("not json");
    await new Promise((r) => setTimeout(r, 10));
  });

  it("ignores unknown control message types", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));

    ws.simulateMessage(JSON.stringify({ type: "unknown_type" }));
    await new Promise((r) => setTimeout(r, 10));
  });

  it("cleans up session on ws.onclose", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));
    expect(sessions.size).toBe(1);

    await ws.simulateClose();
    await new Promise((r) => setTimeout(r, 10));
    expect(sessions.size).toBe(0);
  });

  it("handles ws.onerror without crashing", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
    });

    // Error before open — should not throw
    ws.simulateError();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("includes logContext in logs", async () => {
    const ws = new MockServerWs();
    const sessions = new Map<string, ServerSession>();

    handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
      createSession: (id, wsArg) => createTestSession(id, wsArg),
      logContext: { slug: "test-agent" },
    });

    await ws.simulateOpen();
    await new Promise((r) => setTimeout(r, 10));
    // Just verify it doesn't crash with logContext
    expect(sessions.size).toBe(1);
  });
});
