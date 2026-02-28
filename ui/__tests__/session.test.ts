import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { parseServerMessage, VoiceSession } from "../session.ts";
import { MSG } from "../../sdk/shared-protocol.ts";
import type { AgentOptions } from "../types.ts";
import { PING_INTERVAL_MS } from "../types.ts";

// ── parseServerMessage tests ─────────────────────────────────────

describe("parseServerMessage", () => {
  it("parses a valid ready message", () => {
    const msg = parseServerMessage(
      JSON.stringify({
        type: "ready",
        sampleRate: 16000,
        ttsSampleRate: 24000,
      }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("ready");
  });

  it("parses a valid greeting message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "greeting", text: "Hello!" }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("greeting");
  });

  it("parses a transcript message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "transcript", text: "hello", final: false }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("transcript");
  });

  it("parses a turn message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "turn", text: "What's the weather?" }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("turn");
  });

  it("parses a thinking message", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "thinking" }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("thinking");
  });

  it("parses a chat message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "chat", text: "It's sunny!", steps: [] }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("chat");
  });

  it("parses a tts_done message", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "tts_done" }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("tts_done");
  });

  it("parses a cancelled message", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "cancelled" }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("cancelled");
  });

  it("parses a reset message", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "reset" }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("reset");
  });

  it("parses a pong message", () => {
    const msg = parseServerMessage(JSON.stringify({ type: "pong" }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("pong");
  });

  it("parses an error message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "error", message: "Something failed" }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("error");
  });

  it("returns null for invalid JSON", () => {
    const msg = parseServerMessage("not json at all");
    expect(msg).toBeNull();
  });

  it("returns null for unknown type", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "unknown_type" }),
    );
    expect(msg).toBeNull();
  });

  it("returns null when type is missing", () => {
    const msg = parseServerMessage(JSON.stringify({ text: "no type" }));
    expect(msg).toBeNull();
  });

  it("returns null when type is not a string", () => {
    const msg = parseServerMessage(JSON.stringify({ type: 123 }));
    expect(msg).toBeNull();
  });

  it("returns null for null value", () => {
    const msg = parseServerMessage("null");
    expect(msg).toBeNull();
  });

  it("returns null for array", () => {
    const msg = parseServerMessage(JSON.stringify([1, 2, 3]));
    expect(msg).toBeNull();
  });

  it("returns null for primitive", () => {
    const msg = parseServerMessage(JSON.stringify("just a string"));
    expect(msg).toBeNull();
  });
});

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
    // Auto-open after microtask
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

  /** Simulate receiving a message from the server. */
  simulateMessage(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

// ── VoiceSession tests ───────────────────────────────────────────

describe("VoiceSession", () => {
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
    // Mock location for URL construction
    if (!("location" in globalThis)) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).location = { origin: "http://localhost:3000" };
    }
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  const defaultOptions = {
    platformUrl: "http://localhost:3000",
  };

  function createSession(
    opts: AgentOptions = defaultOptions,
  ): VoiceSession {
    return new VoiceSession(opts);
  }

  describe("constructor", () => {
    it("creates a session in connecting state", () => {
      const session = createSession();
      expect(session).toBeDefined();
    });
  });

  describe("on() and emit()", () => {
    it("on() returns unsubscribe function", () => {
      const session = createSession();
      const states: string[] = [];
      const unsub = session.on("stateChange", (s) => states.push(s));
      expect(typeof unsub).toBe("function");
      unsub();
    });
  });

  describe("connect()", () => {
    it("creates a WebSocket and transitions to ready on open", async () => {
      const states: string[] = [];
      const session = createSession();
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      expect(lastWs).not.toBeNull();
      expect(states).toContain("ready");
      session.disconnect();
    });

    it("constructs correct WebSocket URL from platformUrl", async () => {
      const session = createSession({
        platformUrl: "https://example.com/api",
      });
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      const url = lastWs!.url.toString();
      expect(url).toContain("wss://");
      expect(url).toContain("session");
      session.disconnect();
    });

    it("uses ws:// for http:// platformUrl", async () => {
      const session = createSession({
        platformUrl: "http://localhost:3000",
      });
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      const url = lastWs!.url.toString();
      expect(url).toContain("ws://");
      session.disconnect();
    });
  });

  describe("handleServerMessage", () => {
    it("handles GREETING message", async () => {
      const messages: unknown[] = [];
      const states: string[] = [];
      const session = createSession();
      session.on("message", (m) => messages.push(m));
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: MSG.GREETING, text: "Hi!" }),
      );
      await new Promise((r) => setTimeout(r, 10));

      expect(messages).toHaveLength(1);
      expect((messages[0] as Record<string, unknown>).role).toBe("assistant");
      expect(states).toContain("speaking");
      session.disconnect();
    });

    it("handles TRANSCRIPT message", async () => {
      const transcripts: string[] = [];
      const session = createSession();
      session.on("transcript", (t) => transcripts.push(t));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: MSG.TRANSCRIPT, text: "hello" }),
      );

      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toBe("hello");
      session.disconnect();
    });

    it("handles TURN message", async () => {
      const messages: unknown[] = [];
      const transcripts: string[] = [];
      const session = createSession();
      session.on("message", (m) => messages.push(m));
      session.on("transcript", (t) => transcripts.push(t));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(JSON.stringify({ type: MSG.TURN, text: "test" }));

      expect(messages).toHaveLength(1);
      expect((messages[0] as Record<string, unknown>).role).toBe("user");
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toBe("");
      session.disconnect();
    });

    it("handles THINKING message", async () => {
      const states: string[] = [];
      const session = createSession();
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(JSON.stringify({ type: MSG.THINKING }));
      expect(states).toContain("thinking");
      session.disconnect();
    });

    it("handles CHAT message", async () => {
      const messages: unknown[] = [];
      const states: string[] = [];
      const session = createSession();
      session.on("message", (m) => messages.push(m));
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: MSG.CHAT, text: "response", steps: ["step1"] }),
      );

      expect(messages).toHaveLength(1);
      expect((messages[0] as Record<string, string>).role).toBe("assistant");
      expect(states).toContain("speaking");
      session.disconnect();
    });

    it("handles TTS_DONE message", async () => {
      const states: string[] = [];
      const session = createSession();
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Need to be in a state that can transition to listening
      lastWs!.simulateMessage(
        JSON.stringify({ type: MSG.GREETING, text: "Hi" }),
      );
      lastWs!.simulateMessage(JSON.stringify({ type: MSG.TTS_DONE }));

      expect(states).toContain("listening");
      session.disconnect();
    });

    it("handles CANCELLED message", async () => {
      const states: string[] = [];
      const session = createSession();
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(JSON.stringify({ type: MSG.CANCELLED }));
      expect(states).toContain("listening");
      session.disconnect();
    });

    it("handles RESET message", async () => {
      let resetCalled = false;
      const session = createSession();
      session.on("reset", () => {
        resetCalled = true;
      });

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(JSON.stringify({ type: MSG.RESET }));
      expect(resetCalled).toBe(true);
      session.disconnect();
    });

    it("handles PONG message", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw
      lastWs!.simulateMessage(JSON.stringify({ type: MSG.PONG }));
      session.disconnect();
    });

    it("handles ERROR message", async () => {
      const errors: string[] = [];
      const session = createSession();
      session.on("error", (e) => errors.push(e.message));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({ type: MSG.ERROR, message: "Something went wrong" }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Something went wrong");
      session.disconnect();
    });

    it("handles ERROR message with details", async () => {
      const errors: string[] = [];
      const session = createSession();
      session.on("error", (e) => errors.push(e.message));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      lastWs!.simulateMessage(
        JSON.stringify({
          type: MSG.ERROR,
          message: "Failed",
          details: ["detail1", "detail2"],
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("detail1");
      session.disconnect();
    });

    it("handles binary audio data", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw (player is null, so data is just ignored)
      lastWs!.simulateMessage(new ArrayBuffer(16));
      session.disconnect();
    });

    it("ignores unknown message types", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw
      lastWs!.simulateMessage(JSON.stringify({ type: "unknown" }));
      session.disconnect();
    });

    it("ignores invalid JSON", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw
      lastWs!.simulateMessage("not json");
      session.disconnect();
    });
  });

  describe("cancel()", () => {
    it("sends cancel message over WebSocket", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      session.cancel();

      const sentStrings = lastWs!.sent.filter(
        (d): d is string => typeof d === "string",
      );
      const cancelMsg = sentStrings.find((s) =>
        JSON.parse(s).type === MSG.CANCEL
      );
      expect(cancelMsg).toBeDefined();
      session.disconnect();
    });

    it("transitions to listening state", async () => {
      const states: string[] = [];
      const session = createSession();
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      session.cancel();
      expect(states).toContain("listening");
      session.disconnect();
    });
  });

  describe("reset()", () => {
    it("sends reset message when WS is open", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      session.reset();

      const sentStrings = lastWs!.sent.filter(
        (d): d is string => typeof d === "string",
      );
      const resetMsg = sentStrings.find((s) =>
        JSON.parse(s).type === MSG.RESET
      );
      expect(resetMsg).toBeDefined();
      session.disconnect();
    });

    it("emits reset and reconnects when WS is closed", async () => {
      let resetEmitted = false;
      const session = createSession();
      session.on("reset", () => {
        resetEmitted = true;
      });

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Close the WS first
      session.disconnect();

      // Reset when disconnected triggers reconnection
      session.reset();
      await new Promise((r) => setTimeout(r, 10));

      expect(resetEmitted).toBe(true);
      // Disconnect again to clean up the reconnected session
      session.disconnect();
    });
  });

  describe("disconnect()", () => {
    it("emits disconnected with intentional: true", async () => {
      let disconnectData: { intentional: boolean } | null = null;
      const session = createSession();
      session.on("disconnected", (d) => {
        disconnectData = d;
      });

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      session.disconnect();

      expect(disconnectData).not.toBeNull();
      expect(disconnectData!.intentional).toBe(true);
    });

    it("closes WebSocket", async () => {
      const session = createSession();
      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      const ws = lastWs!;
      session.disconnect();
      expect(ws.readyState).toBe(MockClientWebSocket.CLOSED);
    });

    it("is safe to call when not connected", () => {
      const session = createSession();
      expect(() => session.disconnect()).not.toThrow();
    });
  });

  describe("reconnection on close", () => {
    it("emits disconnected on unexpected close", async () => {
      let disconnectData: { intentional: boolean } | null = null;
      const session = createSession();
      session.on("disconnected", (d) => {
        disconnectData = d;
      });

      session.connect();
      await new Promise((r) => setTimeout(r, 10));

      // Simulate unexpected close
      lastWs!.close(1006);
      await new Promise((r) => setTimeout(r, 10));

      expect(disconnectData).not.toBeNull();
      expect(disconnectData!.intentional).toBe(false);
      session.disconnect();
    });
  });

  describe("ping/pong", () => {
    it("sends ping messages at interval", async () => {
      const time = new FakeTime();
      try {
        const session = createSession();
        session.connect();

        // Manually trigger open
        await time.tickAsync(0);

        // Advance past ping interval
        await time.tickAsync(PING_INTERVAL_MS + 10);

        const sentStrings = lastWs!.sent.filter(
          (d): d is string => typeof d === "string",
        );
        const pings = sentStrings.filter((s) => {
          try {
            return JSON.parse(s).type === MSG.PING;
          } catch {
            return false;
          }
        });
        expect(pings.length).toBeGreaterThanOrEqual(1);

        // Cleanup session within FakeTime context
        session.disconnect();
      } finally {
        time.restore();
      }
    });
  });

  describe("changeState", () => {
    it("does not emit if state hasn't changed", async () => {
      const states: string[] = [];
      const session = createSession();
      session.on("stateChange", (s) => states.push(s));

      session.connect();
      await new Promise((r) => setTimeout(r, 10));
      // "ready" emitted once

      // Sending another message that would transition to ready again
      // This exercises the early return in changeState
      lastWs!.simulateMessage(JSON.stringify({ type: MSG.CANCELLED }));
      lastWs!.simulateMessage(JSON.stringify({ type: MSG.CANCELLED }));
      // Second CANCELLED should not emit (already in listening)
      const listeningCount = states.filter((s) => s === "listening").length;
      expect(listeningCount).toBe(1);
      session.disconnect();
    });
  });
});
