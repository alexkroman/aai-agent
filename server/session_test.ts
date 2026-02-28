import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ServerSession } from "./session.ts";
import type { AgentConfig } from "./types.ts";
import {
  createMockLLMResponse,
  createMockSessionDeps,
  createMockTransport,
  getSentJson,
} from "./_test_utils.ts";
import type { SttEvents } from "./stt.ts";

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

function createSessionWithSttEvents(
  overrides?: Parameters<typeof createMockSessionDeps>[0],
  agentConfig?: Partial<AgentConfig>,
) {
  const events: { current: SttEvents | null } = { current: null };
  const result = createSession(
    {
      connectStt: (_key, _config, sttEvents) => {
        events.current = sttEvents;
        return Promise.resolve({
          send: () => {},
          clear: () => {},
          close: () => {},
        });
      },
      ...overrides,
    },
    agentConfig,
  );
  return { ...result, events };
}

describe("ServerSession", () => {
  describe("start()", () => {
    it("sends READY message with sample rates", () => {
      const { session, transport } = createSession();
      session.start();
      const messages = getSentJson(transport);
      const ready = messages.find((m) => m.type === "ready");
      expect(ready).toBeDefined();
      expect(ready!.sampleRate).toBeDefined();
      expect(ready!.ttsSampleRate).toBeDefined();
    });

    it("defers greeting until onAudioReady", () => {
      const { session, transport } = createSession();
      session.start();
      const messages = getSentJson(transport);
      expect(messages.find((m) => m.type === "greeting")).toBeUndefined();
    });

    it("sends error on STT connection failure", async () => {
      const { session, transport } = createSession({
        connectStt: () => {
          throw new Error("STT connection refused");
        },
      });
      session.start();
      await new Promise((r) => setTimeout(r, 50));

      const messages = getSentJson(transport);
      expect(messages.find((m) => m.type === "error")).toBeDefined();
    });
  });

  describe("onAudioReady()", () => {
    it("sends greeting and starts TTS", async () => {
      const { session, transport, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      session.onAudioReady();
      const messages = getSentJson(transport);
      const greeting = messages.find((m) => m.type === "greeting");
      expect(greeting).toBeDefined();
      expect(greeting!.text).toBe("Hi there!");
      expect(ttsClient.synthesizeCalls.length).toBeGreaterThan(0);
    });

    it("is a no-op on second call", async () => {
      const { session, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      session.onAudioReady();
      const firstCount = ttsClient.synthesizeCalls.length;
      session.onAudioReady();
      expect(ttsClient.synthesizeCalls.length).toBe(firstCount);
    });
  });

  describe("onAudio()", () => {
    it("relays data to STT handle", async () => {
      const { session, sttHandle } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      session.onAudio(new Uint8Array([1, 2, 3]));
      expect(sttHandle.sentData.length).toBe(1);
    });

    it("does not throw before STT is connected", () => {
      const { session } = createSession({
        connectStt: () => new Promise(() => {}), // never resolves
      });
      session.start();
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
      expect(getSentJson(transport).find((m) => m.type === "cancelled"))
        .toBeDefined();
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
      expect(messages.find((m) => m.type === "reset")).toBeDefined();
      expect(messages.filter((m) => m.type === "greeting").length)
        .toBeGreaterThan(0);
    });
  });

  describe("handleTurn()", () => {
    it("sends TURN, THINKING, CHAT, triggers TTS", async () => {
      const ctx = createSessionWithSttEvents();
      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.events.current!.onTurn("What is the weather?");
      await ctx.session.turnPromise;

      const messages = getSentJson(ctx.transport);
      expect(messages.find((m) => m.type === "turn")!.text).toBe(
        "What is the weather?",
      );
      expect(messages.find((m) => m.type === "thinking")).toBeDefined();
      expect(messages.find((m) => m.type === "chat")!.text).toBe(
        "Hello from LLM",
      );
      expect(ctx.llmCalls.length).toBe(1);
      expect(ctx.ttsClient.synthesizeCalls.length).toBeGreaterThan(0);
    });

    it("handles tool calls", async () => {
      const toolResponse = createMockLLMResponse(null, [
        { id: "call1", name: "get_weather", arguments: '{"city":"NYC"}' },
      ]);
      const finalResponse = createMockLLMResponse("It's sunny in NYC.");

      let callIdx = 0;
      const ctx = createSessionWithSttEvents({
        callLLM: () => {
          const responses = [toolResponse, finalResponse];
          return Promise.resolve(responses[callIdx++] ?? finalResponse);
        },
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.events.current!.onTurn("What's the weather in NYC?");
      await ctx.session.turnPromise;

      expect(ctx.executeTool.calls.length).toBe(1);
      expect(ctx.executeTool.calls[0].name).toBe("get_weather");
      expect(getSentJson(ctx.transport).find((m) => m.type === "chat")!.text)
        .toBe("It's sunny in NYC.");
    });

    it("sends ERROR on LLM failure", async () => {
      const ctx = createSessionWithSttEvents({
        callLLM: () => {
          throw new Error("LLM unavailable");
        },
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.events.current!.onTurn("Hello");
      await ctx.session.turnPromise;

      expect(getSentJson(ctx.transport).find((m) => m.type === "error"))
        .toBeDefined();
    });

    it("sends TTS_DONE for empty response", async () => {
      const ctx = createSessionWithSttEvents({
        callLLM: () => Promise.resolve(createMockLLMResponse("")),
      });

      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.events.current!.onTurn("Hello");
      await ctx.session.turnPromise;

      expect(getSentJson(ctx.transport).find((m) => m.type === "tts_done"))
        .toBeDefined();
    });

    it("relays STT transcript to browser", async () => {
      const ctx = createSessionWithSttEvents();
      ctx.session.start();
      await new Promise((r) => setTimeout(r, 10));

      ctx.events.current!.onTranscript("partial text", false);
      const transcript = getSentJson(ctx.transport).find((m) =>
        m.type === "transcript"
      );
      expect(transcript).toBeDefined();
      expect(transcript!.text).toBe("partial text");
    });
  });

  describe("trySendJson when WS is closed", () => {
    it("silently drops messages", () => {
      const transport = {
        sent: [] as (string | ArrayBuffer | Uint8Array)[],
        readyState: 3,
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
      session.start();
      expect(transport.sent).toHaveLength(0);
    });
  });

  describe("stop()", () => {
    it("closes STT and TTS", async () => {
      const { session, sttHandle, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      await session.stop();
      expect(sttHandle.closeCalled).toBe(true);
      expect(ttsClient.closeCalled).toBe(true);
    });

    it("is idempotent", async () => {
      const { session, ttsClient } = createSession();
      session.start();
      await new Promise((r) => setTimeout(r, 10));

      await session.stop();
      const firstCloseCount = ttsClient.closeCalled;
      await session.stop();
      expect(ttsClient.closeCalled).toBe(firstCloseCount);
    });
  });
});
