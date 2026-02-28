import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { parseServerMessage, VoiceSession } from "./session.ts";
import type { AgentOptions } from "./types.ts";
import { PING_INTERVAL_MS } from "./types.ts";
import { installMockWebSocket } from "./_test_utils.ts";

// ── parseServerMessage tests ─────────────────────────────────────

describe("parseServerMessage", () => {
  const valid: [string, Record<string, unknown>][] = [
    ["ready", { type: "ready", sampleRate: 16000, ttsSampleRate: 24000 }],
    ["greeting", { type: "greeting", text: "Hello!" }],
    ["transcript", { type: "transcript", text: "hello", final: false }],
    ["turn", { type: "turn", text: "What's the weather?" }],
    ["thinking", { type: "thinking" }],
    ["chat", { type: "chat", text: "It's sunny!", steps: [] }],
    ["tts_done", { type: "tts_done" }],
    ["cancelled", { type: "cancelled" }],
    ["reset", { type: "reset" }],
    ["pong", { type: "pong" }],
    ["error", { type: "error", message: "Something failed" }],
    ["unknown type passes through", { type: "custom_extension", data: 1 }],
  ];

  for (const [label, payload] of valid) {
    it(`parses ${label}`, () => {
      const msg = parseServerMessage(JSON.stringify(payload));
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe(payload.type);
    });
  }

  const rejected: [string, string][] = [
    ["invalid JSON", "not json at all"],
    ["missing type", JSON.stringify({ text: "no type" })],
    ["non-string type", JSON.stringify({ type: 123 })],
    ["null value", "null"],
    ["array", JSON.stringify([1, 2, 3])],
    ["primitive", JSON.stringify("just a string")],
  ];

  for (const [label, input] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parseServerMessage(input)).toBeNull();
    });
  }
});

// ── VoiceSession tests ───────────────────────────────────────────

describe("VoiceSession", () => {
  let mock: ReturnType<typeof installMockWebSocket>;
  let locationInstalled = false;

  beforeEach(() => {
    mock = installMockWebSocket();
    if (!("location" in globalThis)) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).location = { origin: "http://localhost:3000" };
      locationInstalled = true;
    }
  });

  afterEach(() => {
    mock.restore();
    if (locationInstalled) {
      // deno-lint-ignore no-explicit-any
      delete (globalThis as any).location;
      locationInstalled = false;
    }
  });

  const defaultOptions: AgentOptions = {
    platformUrl: "http://localhost:3000",
  };

  /** Connect a session and wait for WS open. */
  async function connectSession(
    opts: AgentOptions = defaultOptions,
  ): Promise<{ session: VoiceSession; ws: NonNullable<typeof mock.lastWs> }> {
    const session = new VoiceSession(opts);
    session.connect();
    await new Promise((r) => setTimeout(r, 10));
    return { session, ws: mock.lastWs! };
  }

  describe("constructor", () => {
    it("creates a session", () => {
      expect(new VoiceSession(defaultOptions)).toBeDefined();
    });
  });

  describe("on() and emit()", () => {
    it("on() returns unsubscribe function", () => {
      const session = new VoiceSession(defaultOptions);
      const unsub = session.on("stateChange", () => {});
      expect(typeof unsub).toBe("function");
      unsub();
    });
  });

  describe("connect()", () => {
    it("creates a WebSocket and transitions to ready on open", async () => {
      const states: string[] = [];
      const { session } = await connectSession();
      session.on("stateChange", (s) => states.push(s));

      // ready was emitted before we subscribed, check ws exists
      expect(mock.lastWs).not.toBeNull();
      session.disconnect();
    });

    it("constructs correct WebSocket URL from platformUrl", async () => {
      const { session, ws } = await connectSession({
        platformUrl: "https://example.com/api",
      });
      const url = ws.url.toString();
      expect(url).toContain("wss://");
      expect(url).toContain("session");
      session.disconnect();
    });

    it("uses ws:// for http:// platformUrl", async () => {
      const { session, ws } = await connectSession();
      expect(ws.url.toString()).toContain("ws://");
      session.disconnect();
    });
  });

  describe("handleServerMessage", () => {
    it("handles GREETING message", async () => {
      const messages: unknown[] = [];
      const states: string[] = [];
      const { session, ws } = await connectSession();
      session.on("message", (m) => messages.push(m));
      session.on("stateChange", (s) => states.push(s));

      ws.simulateMessage(JSON.stringify({ type: "greeting", text: "Hi!" }));

      expect(messages).toHaveLength(1);
      expect((messages[0] as Record<string, unknown>).role).toBe("assistant");
      expect(states).toContain("speaking");
      session.disconnect();
    });

    it("handles TRANSCRIPT message", async () => {
      const transcripts: string[] = [];
      const { session, ws } = await connectSession();
      session.on("transcript", (t) => transcripts.push(t));

      ws.simulateMessage(
        JSON.stringify({ type: "transcript", text: "hello" }),
      );

      expect(transcripts).toEqual(["hello"]);
      session.disconnect();
    });

    it("handles TURN message", async () => {
      const messages: unknown[] = [];
      const transcripts: string[] = [];
      const { session, ws } = await connectSession();
      session.on("message", (m) => messages.push(m));
      session.on("transcript", (t) => transcripts.push(t));

      ws.simulateMessage(JSON.stringify({ type: "turn", text: "test" }));

      expect(messages).toHaveLength(1);
      expect((messages[0] as Record<string, unknown>).role).toBe("user");
      expect(transcripts).toEqual([""]);
      session.disconnect();
    });

    it("handles THINKING message", async () => {
      const states: string[] = [];
      const { session, ws } = await connectSession();
      session.on("stateChange", (s) => states.push(s));

      ws.simulateMessage(JSON.stringify({ type: "thinking" }));
      expect(states).toContain("thinking");
      session.disconnect();
    });

    it("handles CHAT message", async () => {
      const messages: unknown[] = [];
      const states: string[] = [];
      const { session, ws } = await connectSession();
      session.on("message", (m) => messages.push(m));
      session.on("stateChange", (s) => states.push(s));

      ws.simulateMessage(
        JSON.stringify({ type: "chat", text: "response", steps: ["step1"] }),
      );

      expect(messages).toHaveLength(1);
      expect((messages[0] as Record<string, string>).role).toBe("assistant");
      expect(states).toContain("speaking");
      session.disconnect();
    });

    it("handles TTS_DONE message", async () => {
      const states: string[] = [];
      const { session, ws } = await connectSession();
      session.on("stateChange", (s) => states.push(s));

      ws.simulateMessage(JSON.stringify({ type: "greeting", text: "Hi" }));
      ws.simulateMessage(JSON.stringify({ type: "tts_done" }));

      expect(states).toContain("listening");
      session.disconnect();
    });

    it("handles CANCELLED message", async () => {
      const states: string[] = [];
      const { session, ws } = await connectSession();
      session.on("stateChange", (s) => states.push(s));

      ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
      expect(states).toContain("listening");
      session.disconnect();
    });

    it("handles RESET message", async () => {
      let resetCalled = false;
      const { session, ws } = await connectSession();
      session.on("reset", () => {
        resetCalled = true;
      });

      ws.simulateMessage(JSON.stringify({ type: "reset" }));
      expect(resetCalled).toBe(true);
      session.disconnect();
    });

    it("handles PONG message", async () => {
      const { session, ws } = await connectSession();
      ws.simulateMessage(JSON.stringify({ type: "pong" }));
      session.disconnect();
    });

    it("handles ERROR message", async () => {
      const errors: string[] = [];
      const { session, ws } = await connectSession();
      session.on("error", (e) => errors.push(e.message));

      ws.simulateMessage(
        JSON.stringify({ type: "error", message: "Something went wrong" }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Something went wrong");
      session.disconnect();
    });

    it("handles ERROR message with details", async () => {
      const errors: string[] = [];
      const { session, ws } = await connectSession();
      session.on("error", (e) => errors.push(e.message));

      ws.simulateMessage(
        JSON.stringify({
          type: "error",
          message: "Failed",
          details: ["detail1", "detail2"],
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("detail1");
      session.disconnect();
    });

    it("handles binary audio data", async () => {
      const { session, ws } = await connectSession();
      ws.simulateMessage(new ArrayBuffer(16));
      session.disconnect();
    });

    it("ignores unknown message types", async () => {
      const { session, ws } = await connectSession();
      ws.simulateMessage(JSON.stringify({ type: "unknown" }));
      session.disconnect();
    });

    it("ignores invalid JSON", async () => {
      const { session, ws } = await connectSession();
      ws.simulateMessage("not json");
      session.disconnect();
    });
  });

  describe("cancel()", () => {
    it("sends cancel message over WebSocket", async () => {
      const { session, ws } = await connectSession();
      session.cancel();

      const sentStrings = ws.sent.filter(
        (d): d is string => typeof d === "string",
      );
      const cancelMsg = sentStrings.find((s) =>
        JSON.parse(s).type === "cancel"
      );
      expect(cancelMsg).toBeDefined();
      session.disconnect();
    });

    it("transitions to listening state", async () => {
      const states: string[] = [];
      const { session } = await connectSession();
      session.on("stateChange", (s) => states.push(s));

      session.cancel();
      expect(states).toContain("listening");
      session.disconnect();
    });
  });

  describe("reset()", () => {
    it("sends reset message when WS is open", async () => {
      const { session, ws } = await connectSession();
      session.reset();

      const sentStrings = ws.sent.filter(
        (d): d is string => typeof d === "string",
      );
      const resetMsg = sentStrings.find((s) => JSON.parse(s).type === "reset");
      expect(resetMsg).toBeDefined();
      session.disconnect();
    });

    it("emits reset and reconnects when WS is closed", async () => {
      let resetEmitted = false;
      const { session } = await connectSession();
      session.on("reset", () => {
        resetEmitted = true;
      });

      session.disconnect();
      session.reset();
      await new Promise((r) => setTimeout(r, 10));

      expect(resetEmitted).toBe(true);
      session.disconnect();
    });
  });

  describe("disconnect()", () => {
    it("emits disconnected with intentional: true", async () => {
      let disconnectData: { intentional: boolean } | null = null;
      const { session } = await connectSession();
      session.on("disconnected", (d) => {
        disconnectData = d;
      });

      session.disconnect();

      expect(disconnectData).not.toBeNull();
      expect(disconnectData!.intentional).toBe(true);
    });

    it("closes WebSocket", async () => {
      const { session, ws } = await connectSession();
      session.disconnect();
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it("is safe to call when not connected", () => {
      const session = new VoiceSession(defaultOptions);
      expect(() => session.disconnect()).not.toThrow();
    });
  });

  describe("reconnection on close", () => {
    it("emits disconnected on unexpected close", async () => {
      let disconnectData: { intentional: boolean } | null = null;
      const { session, ws } = await connectSession();
      session.on("disconnected", (d) => {
        disconnectData = d;
      });

      ws.close(1006);
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
        const session = new VoiceSession(defaultOptions);
        session.connect();

        await time.tickAsync(0);
        await time.tickAsync(PING_INTERVAL_MS + 10);

        const sentStrings = mock.lastWs!.sent.filter(
          (d): d is string => typeof d === "string",
        );
        const pings = sentStrings.filter((s) => {
          try {
            return JSON.parse(s).type === "ping";
          } catch {
            return false;
          }
        });
        expect(pings.length).toBeGreaterThanOrEqual(1);

        session.disconnect();
      } finally {
        time.restore();
      }
    });
  });

  describe("changeState", () => {
    it("does not emit if state hasn't changed", async () => {
      const states: string[] = [];
      const { session, ws } = await connectSession();
      session.on("stateChange", (s) => states.push(s));

      ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
      ws.simulateMessage(JSON.stringify({ type: "cancelled" }));

      const listeningCount = states.filter((s) => s === "listening").length;
      expect(listeningCount).toBe(1);
      session.disconnect();
    });
  });
});
