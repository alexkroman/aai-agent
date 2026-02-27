// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { stubBrowserGlobals, resetWsInstances, wsInstances } from "./_mocks.js";

stubBrowserGlobals();

import { useVoiceAgent, type VoiceAgentOptions } from "../react.js";

describe("useVoiceAgent", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  function lastWs() {
    return wsInstances[wsInstances.length - 1];
  }

  it("returns initial state shape", () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    expect(result.current).toHaveProperty("state");
    expect(result.current).toHaveProperty("messages");
    expect(result.current).toHaveProperty("transcript");
    expect(result.current).toHaveProperty("error");
    expect(result.current).toHaveProperty("cancel");
    expect(result.current).toHaveProperty("reset");
    expect(result.current.messages).toEqual([]);
    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBe("");
  });

  it("transitions to ready state on WS open", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));
  });

  it("transitions to listening on ready message", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "ready", sampleRate: 16000, ttsSampleRate: 24000 });
    });

    await vi.waitFor(() => expect(result.current.state).toBe("listening"));
  });

  it("adds messages on greeting and chat", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "greeting", text: "Hello!" });
    });

    expect(result.current.messages).toContainEqual({
      role: "assistant",
      text: "Hello!",
    });
  });

  it("updates transcript on transcript message", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "transcript", text: "Hello wor" });
    });

    expect(result.current.transcript).toBe("Hello wor");
  });

  it("sets error on error message", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "error", message: "Something failed" });
    });

    expect(result.current.error).toBe("Something failed");
    expect(result.current.state).toBe("error");
    consoleSpy.mockRestore();
  });

  it("cancel delegates to session", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      result.current.cancel();
    });

    const cancelMsg = lastWs().sent.find((msg) => {
      const parsed = JSON.parse(msg as string);
      return parsed.type === "cancel";
    });
    expect(cancelMsg).toBeDefined();
  });

  it("reset clears messages, transcript, and error on server RESET", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "greeting", text: "Hello!" });
    });
    expect(result.current.messages.length).toBe(1);

    act(() => {
      result.current.reset();
    });

    // Messages not cleared yet — waiting for server RESET ack
    expect(result.current.messages.length).toBe(1);

    // Simulate server RESET acknowledgment
    act(() => {
      lastWs().simulateMessage({ type: "reset" });
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBe("");
  });

  it("disconnects on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    const ws = lastWs();
    unmount();
    expect(ws.readyState).toBe(3);
  });

  it("accepts flat instructions/greeting/voice and tools options", async () => {
    const opts: VoiceAgentOptions = {
      apiKey: "pk_test",
      platformUrl: "ws://localhost:3000",
      instructions: "Be helpful",
      greeting: "Hi!",
      voice: "luna",
      tools: {
        search: {
          description: "Search the web",
          parameters: { query: "string" },
          handler: async (args: any) => `Results for ${args.query}`,
        },
      },
    };

    const { result } = renderHook(() => useVoiceAgent(opts));

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    const configMsg = JSON.parse(lastWs().sent[1] as string);
    expect(configMsg.instructions).toBe("Be helpful");
    expect(configMsg.voice).toBe("luna");
    expect(configMsg.tools[0].name).toBe("search");
  });

  it("handles connection error", () => {
    const OriginalWS = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = class ThrowingWS {
      constructor() {
        throw new Error("Connection refused");
      }
    };

    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("Connection");

    (globalThis as any).WebSocket = OriginalWS;
  });
});
