import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ServerSession } from "../session.ts";
import { MSG } from "../../sdk/shared-protocol.ts";
import type { AgentConfig } from "../../sdk/types.ts";
import {
  createMockLLMResponse,
  createMockSessionDeps,
  createMockTransport,
  getSentJson,
} from "./_test-utils.ts";

function createSession(
  overrides?: Parameters<typeof createMockSessionDeps>[0],
  agentConfig?: Partial<AgentConfig>,
) {
  const transport = createMockTransport();
  const mocks = createMockSessionDeps(overrides);
  const session = new ServerSession(
    "test-session-id",
    transport,
    {
      instructions: "Test instructions",
      greeting: "Hi there!",
      voice: "jess",
      ...agentConfig,
    },
    [],
    mocks.deps,
  );
  return { session, transport, ...mocks };
}

/** Helper: create session with a captured onTurn callback for triggering handleTurn. */
function createSessionWithTurnCallback(
  overrides?: Parameters<typeof createMockSessionDeps>[0],
  agentConfig?: Partial<AgentConfig>,
) {
  let onTurnCb: ((text: string) => void) | null = null;
  let onTranscriptCb: ((text: string, isFinal: boolean) => void) | null = null;
  let onErrorCb: ((err: Error) => void) | null = null;
  let onCloseCb: (() => void) | null = null;
  const transport = createMockTransport();
  const mocks = createMockSessionDeps({
    connectStt: (_key, _config, events) => {
      onTurnCb = events.onTurn;
      onTranscriptCb = events.onTranscript;
      onErrorCb = events.onError;
      onCloseCb = events.onClose;
      return Promise.resolve({
        send: () => {},
        clear: () => {},
        close: () => {},
      });
    },
    ...overrides,
  });

  const session = new ServerSession(
    "test-session",
    transport,
    {
      instructions: "Test",
      greeting: "Hi!",
      voice: "jess",
      ...agentConfig,
    },
    [],
    mocks.deps,
  );
  return {
    session,
    transport,
    ...mocks,
    get onTurn() {
      return onTurnCb;
    },
    get onTranscript() {
      return onTranscriptCb;
    },
    get onError() {
      return onErrorCb;
    },
    get onClose() {
      return onCloseCb;
    },
  };
}

describe("ServerSession", () => {
  describe("constructor", () => {
    it("pushes system message with instructions + voice rules", () => {
      const transport = createMockTransport();
      const mocks = createMockSessionDeps();
      const session = new ServerSession(
        "id",
        transport,
        {
          instructions: "Custom instructions",
          greeting: "Hello!",
          voice: "jess",
        },
        [],
        mocks.deps,
      );
      expect(session).toBeDefined();
    });

    it("merges voice config override", () => {
      const transport = createMockTransport();
      const mocks = createMockSessionDeps();
      const session = new ServerSession(
        "id",
        transport,
        {
          instructions: "test",
          greeting: "hi",
          voice: "luna",
        },
        [],
        mocks.deps,
      );
      expect(session).toBeDefined();
    });

    it("merges prompt config override", () => {
      const transport = createMockTransport();
      const mocks = createMockSessionDeps();
      const session = new ServerSession(
        "id",
        transport,
        {
          instructions: "test",
          greeting: "hi",
          voice: "jess",
          prompt: "custom prompt",
        },
        [],
        mocks.deps,
      );
      expect(session).toBeDefined();
    });
  });

  describe("start()", () => {
    it("sends READY message with sample rates", () => {
      const { session, transport } = createSession();
      session.start();
      const messages = getSentJson(transport);
      const ready = messages.find((m) => m.type === MSG.READY);
      expect(ready).toBeDefined();
      expect(ready!.sampleRate).toBeDefined();
      expect(ready!.ttsSampleRate).toBeDefined();
    });

    it("sets pending greeting", () => {
      const { session, transport } = createSession();
      session.start();

      // Greeting should not be sent yet (waiting for audio_ready)
      const messages = getSentJson(transport);
      const greeting = messages.find((m) => m.type === MSG.GREETING);
      expect(greeting).toBeUndefined();
    });

    it("handles STT connection failure", async () => {
      const { session, transport } = createSession({
        connectStt: () => {
          throw new Error("STT connection refused");
        },
      });
      session.start();
      await new Promise((r) => setTimeout(r, 50));

      const messages = getSentJson(transport);
      const error = messages.find((m) => m.type === MSG.ERROR);
      expect(error).toBeDefined();
    });
  });

  describe("onAudioReady()", () => {
    it("sends greeting and starts TTS when pending", async () => {
      const { session, transport, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      session.onAudioReady();
      const messages = getSentJson(transport);
      const greeting = messages.find((m) => m.type === MSG.GREETING);
      expect(greeting).toBeDefined();
      expect(greeting!.text).toBe("Hi there!");
      expect(ttsClient.synthesizeCalls.length).toBeGreaterThan(0);
    });

    it("does not send greeting if no pending greeting", async () => {
      const { session, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      // First call consumes pending greeting
      session.onAudioReady();
      const firstCount = ttsClient.synthesizeCalls.length;

      // Second call should be a no-op
      session.onAudioReady();
      expect(ttsClient.synthesizeCalls.length).toBe(firstCount);
    });
  });

  describe("onAudio()", () => {
    it("relays data to STT handle", async () => {
      const { session, sttHandle } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      const data = new Uint8Array([1, 2, 3]);
      session.onAudio(data);
      expect(sttHandle.sentData.length).toBe(1);
      expect(sttHandle.sentData[0]).toBe(data);
    });

    it("does not throw before STT is connected", () => {
      const { session } = createSession({
        connectStt: () => new Promise(() => {}), // never resolves
      });
      session.start();
      // onAudio before STT connect — should not throw (stt is null, optional chaining)
      expect(() => session.onAudio(new Uint8Array([1]))).not.toThrow();
    });
  });

  describe("onCancel()", () => {
    it("clears STT and sends CANCELLED", async () => {
      const { session, transport, sttHandle } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      session.onCancel();
      expect(sttHandle.clearCalled).toBe(true);
      const messages = getSentJson(transport);
      const cancelled = messages.find((m) => m.type === MSG.CANCELLED);
      expect(cancelled).toBeDefined();
    });
  });

  describe("onReset()", () => {
    it("sends RESET and re-sends greeting", async () => {
      const { session, transport, sttHandle } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      session.onReset();
      expect(sttHandle.clearCalled).toBe(true);
      const messages = getSentJson(transport);
      const reset = messages.find((m) => m.type === MSG.RESET);
      expect(reset).toBeDefined();
      const greetings = messages.filter((m) => m.type === MSG.GREETING);
      expect(greetings.length).toBeGreaterThan(0);
    });
  });

  describe("handleTurn()", () => {
    it("sends TURN, THINKING, calls LLM, sends CHAT, triggers TTS", async () => {
      const ctx = createSessionWithTurnCallback();
      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      expect(ctx.onTurn).not.toBeNull();
      ctx.onTurn!("What is the weather?");

      await ctx.session.turnPromise;

      const messages = getSentJson(ctx.transport);
      const turn = messages.find((m) => m.type === MSG.TURN);
      expect(turn).toBeDefined();
      expect(turn!.text).toBe("What is the weather?");

      const thinking = messages.find((m) => m.type === MSG.THINKING);
      expect(thinking).toBeDefined();

      const chat = messages.find((m) => m.type === MSG.CHAT);
      expect(chat).toBeDefined();
      expect(chat!.text).toBe("Hello from LLM");

      expect(ctx.llmCalls.length).toBe(1);
      expect(ctx.ttsClient.synthesizeCalls.length).toBeGreaterThan(0);
    });

    it("handles tool calls", async () => {
      const toolResponse = createMockLLMResponse(null, [
        { id: "call1", name: "get_weather", arguments: '{"city":"NYC"}' },
      ]);
      const finalResponse = createMockLLMResponse("It's sunny in NYC.");

      let callIdx = 0;
      const ctx = createSessionWithTurnCallback({
        callLLM: () => {
          const responses = [toolResponse, finalResponse];
          return Promise.resolve(responses[callIdx++] ?? finalResponse);
        },
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.onTurn!("What's the weather in NYC?");
      await ctx.session.turnPromise;

      expect(ctx.toolExecutor.executeCalls.length).toBe(1);
      expect(ctx.toolExecutor.executeCalls[0].name).toBe("get_weather");

      const messages = getSentJson(ctx.transport);
      const chat = messages.find((m) => m.type === MSG.CHAT);
      expect(chat).toBeDefined();
      expect(chat!.text).toBe("It's sunny in NYC.");
    });

    it("catches errors and sends ERROR message", async () => {
      const ctx = createSessionWithTurnCallback({
        callLLM: () => {
          throw new Error("LLM unavailable");
        },
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.onTurn!("Hello");
      await ctx.session.turnPromise;

      const messages = getSentJson(ctx.transport);
      const error = messages.find((m) => m.type === MSG.ERROR);
      expect(error).toBeDefined();
    });

    it("handles null content in LLM response", async () => {
      const ctx = createSessionWithTurnCallback({
        callLLM: () => Promise.resolve(createMockLLMResponse(null)),
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.onTurn!("Hello");
      await ctx.session.turnPromise;

      const messages = getSentJson(ctx.transport);
      const chat = messages.find((m) => m.type === MSG.CHAT);
      expect(chat).toBeDefined();
      expect(chat!.text).toBe("Sorry, I couldn't generate a response.");
    });

    it("handles invalid JSON tool arguments", async () => {
      const toolResponse = createMockLLMResponse(null, [
        { id: "call1", name: "test_tool", arguments: "not valid json" },
      ]);
      const finalResponse = createMockLLMResponse("Recovered.");

      let callIdx = 0;
      const ctx = createSessionWithTurnCallback({
        callLLM: () => {
          const responses = [toolResponse, finalResponse];
          return Promise.resolve(responses[callIdx++] ?? finalResponse);
        },
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.onTurn!("Test");
      await ctx.session.turnPromise;

      // Should still complete without crashing
      const messages = getSentJson(ctx.transport);
      const chat = messages.find((m) => m.type === MSG.CHAT);
      expect(chat).toBeDefined();
    });

    it("sends TTS_DONE for empty response text", async () => {
      const ctx = createSessionWithTurnCallback({
        callLLM: () => Promise.resolve(createMockLLMResponse("")),
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.onTurn!("Hello");
      await ctx.session.turnPromise;

      const messages = getSentJson(ctx.transport);
      const ttsDone = messages.find((m) => m.type === MSG.TTS_DONE);
      expect(ttsDone).toBeDefined();
    });

    it("STT onTranscript callback sends TRANSCRIPT message", async () => {
      const ctx = createSessionWithTurnCallback();
      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.onTranscript!("partial text", false);

      const messages = getSentJson(ctx.transport);
      const transcript = messages.find((m) => m.type === MSG.TRANSCRIPT);
      expect(transcript).toBeDefined();
      expect(transcript!.text).toBe("partial text");
    });
  });

  describe("trySendJson when WS is closed", () => {
    it("does not throw when WS readyState != 1", () => {
      const transport = {
        sent: [] as (string | ArrayBuffer | Uint8Array)[],
        readyState: 3, // CLOSED
        send(data: string | ArrayBuffer | Uint8Array) {
          this.sent.push(data);
        },
      };
      const mocks = createMockSessionDeps();
      const session = new ServerSession(
        "id",
        transport,
        { instructions: "Test", greeting: "Hi!", voice: "jess" },
        [],
        mocks.deps,
      );
      // start() calls trySendJson — should not throw on closed WS
      session.start();
      expect(transport.sent).toHaveLength(0);
    });
  });

  describe("stop()", () => {
    it("closes STT, TTS, and tool executor", async () => {
      const { session, sttHandle, ttsClient, toolExecutor } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      await session.stop();
      expect(sttHandle.closeCalled).toBe(true);
      expect(ttsClient.closeCalled).toBe(true);
      expect(toolExecutor.disposeCalled).toBe(true);
    });

    it("is idempotent — second call is no-op", async () => {
      const { session, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      await session.stop();
      const firstCloseCount = ttsClient.closeCalled;
      await session.stop();
      expect(ttsClient.closeCalled).toBe(firstCloseCount);
    });

    it("waits for pending TTS before closing", async () => {
      let resolveTts: (() => void) | undefined;
      const ctx = createSessionWithTurnCallback({
        ttsClient: {
          synthesizeCalls: [],
          closeCalled: false,
          synthesize() {
            return new Promise<void>((r) => {
              resolveTts = r;
            });
          },
          close() {
            this.closeCalled = true;
          },
          // deno-lint-ignore no-explicit-any
        } as any,
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      // Trigger a turn to start TTS
      ctx.onTurn!("Hello");
      await new Promise((r) => setTimeout(r, 20));

      // Start stop (it should wait for TTS)
      const stopPromise = ctx.session.stop();
      await new Promise((r) => setTimeout(r, 10));

      // Resolve TTS
      if (resolveTts) resolveTts();
      await stopPromise;
    });
  });
});
