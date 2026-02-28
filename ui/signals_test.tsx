import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { render } from "preact";
import { getContainer, setupDOM } from "./_test_utils.ts";
import { createSessionSignals, useSession } from "./signals.tsx";
import { VoiceSession } from "./session.ts";

// ── Mock WebSocket ───────────────────────────────────────────────

class MockClientWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockClientWebSocket.CONNECTING;
  binaryType = "arraybuffer";
  sent: (string | ArrayBuffer | Uint8Array)[] = [];

  constructor(
    public url: string | URL,
    _protocols?: string | string[],
  ) {
    super();
    queueMicrotask(() => {
      this.readyState = MockClientWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = MockClientWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000 }));
  }

  simulateMessage(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe("createSessionSignals", () => {
  let OriginalWebSocket: typeof WebSocket;
  let lastWs: MockClientWebSocket | null;

  beforeEach(() => {
    OriginalWebSocket = globalThis.WebSocket;
    lastWs = null;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).WebSocket = class extends MockClientWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        lastWs = this;
      }
    };
    if (!("location" in globalThis)) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).location = { origin: "http://localhost:3000" };
    }
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  function createSession(): VoiceSession {
    return new VoiceSession({ platformUrl: "http://localhost:3000" });
  }

  describe("initial values", () => {
    it("has correct defaults", () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      expect(signals.state.value).toBe("connecting");
      expect(signals.messages.value).toEqual([]);
      expect(signals.transcript.value).toBe("");
      expect(signals.error.value).toBe("");
      expect(signals.started.value).toBe(false);
      expect(signals.running.value).toBe(true);
    });
  });

  describe("session event bridging", () => {
    it("updates state signal on stateChange", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      expect(signals.state.value).toBe("ready");
      session.disconnect();
    });

    it("appends to messages signal on message event", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: "greeting", text: "Hello!" }),
      );

      expect(signals.messages.value).toHaveLength(1);
      expect(signals.messages.value[0].role).toBe("assistant");
      expect(signals.messages.value[0].text).toBe("Hello!");

      lastWs!.simulateMessage(
        JSON.stringify({ type: "chat", text: "World", steps: [] }),
      );

      expect(signals.messages.value).toHaveLength(2);
      expect(signals.messages.value[1].text).toBe("World");
      session.disconnect();
    });

    it("updates transcript signal on transcript event", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: "transcript", text: "hello world" }),
      );

      expect(signals.transcript.value).toBe("hello world");
      session.disconnect();
    });

    it("updates error signal on error event", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: "error", message: "Server error" }),
      );

      expect(signals.error.value).toBe("Server error");
      session.disconnect();
    });

    it("clears messages, transcript, and error on reset event", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Accumulate some state
      lastWs!.simulateMessage(
        JSON.stringify({ type: "greeting", text: "Hi" }),
      );
      lastWs!.simulateMessage(
        JSON.stringify({ type: "transcript", text: "partial" }),
      );
      lastWs!.simulateMessage(
        JSON.stringify({ type: "error", message: "oops" }),
      );

      expect(signals.messages.value).toHaveLength(1);
      expect(signals.transcript.value).toBe("partial");
      expect(signals.error.value).toBe("oops");

      // Trigger reset
      lastWs!.simulateMessage(JSON.stringify({ type: "reset" }));

      expect(signals.messages.value).toEqual([]);
      expect(signals.transcript.value).toBe("");
      expect(signals.error.value).toBe("");
      session.disconnect();
    });
  });

  describe("start()", () => {
    it("sets started and running to true and connects", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      expect(signals.started.value).toBe(false);

      signals.start();
      await new Promise((r) => setTimeout(r, 10));

      expect(signals.started.value).toBe(true);
      expect(signals.running.value).toBe(true);
      expect(lastWs).not.toBeNull();
      session.disconnect();
    });
  });

  describe("toggle()", () => {
    it("disconnects when running and sets running to false", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      signals.start();
      await new Promise((r) => setTimeout(r, 10));

      expect(signals.running.value).toBe(true);

      signals.toggle();

      expect(signals.running.value).toBe(false);
    });

    it("reconnects when stopped and sets running to true", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      signals.start();
      await new Promise((r) => setTimeout(r, 10));

      // Stop
      signals.toggle();
      expect(signals.running.value).toBe(false);

      // Resume
      signals.toggle();
      await new Promise((r) => setTimeout(r, 10));

      expect(signals.running.value).toBe(true);
      expect(lastWs).not.toBeNull();
      session.disconnect();
    });
  });

  describe("reset()", () => {
    it("delegates to session.reset()", async () => {
      const session = createSession();
      const signals = createSessionSignals(session);

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      const sentBefore = lastWs!.sent.length;
      signals.reset();

      const sentStrings = lastWs!.sent.slice(sentBefore).filter(
        (d): d is string => typeof d === "string",
      );
      const resetMsg = sentStrings.find((s) => JSON.parse(s).type === "reset");
      expect(resetMsg).toBeDefined();
      session.disconnect();
    });
  });
});

describe("useSession", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("throws when called outside SessionProvider", () => {
    setupDOM();
    const container = getContainer();

    function Orphan() {
      useSession();
      return <div>should not render</div>;
    }

    let caught: Error | null = null;
    try {
      render(<Orphan />, container);
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain(
      "useSession() requires <SessionProvider>",
    );

    render(null, container);
  });
});
