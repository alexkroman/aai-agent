// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { stubBrowserGlobals, resetWsInstances, wsInstances } from "./_mocks.js";

stubBrowserGlobals();

import { useVoiceAgent, type VoiceAgentOptions, SessionErrorCode } from "../react.js";

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
    expect(result.current).toHaveProperty("connect");
    expect(result.current).toHaveProperty("disconnect");
    expect(result.current).toHaveProperty("audioReady");
    expect(result.current).toHaveProperty("isConnected");
    expect(result.current.messages).toEqual([]);
    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.audioReady).toBe(false);
    expect(result.current.isConnected).toBe(false);
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

  it("sets typed error on error message", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "error", message: "Something failed" });
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.code).toBe(SessionErrorCode.SERVER_ERROR);
    expect(result.current.error!.message).toBe("Something failed");
    expect(result.current.error!.recoverable).toBe(true);
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
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(result.current.error).toBeNull();
    consoleSpy.mockRestore();
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

  it("handles connection error with typed SessionError", () => {
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
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.code).toBe(SessionErrorCode.CONNECTION_FAILED);
    expect(result.current.error!.message).toContain("Connection");

    (globalThis as any).WebSocket = OriginalWS;
  });

  it("passes prompt in configure message", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({
        apiKey: "pk_test",
        platformUrl: "ws://localhost:3000",
        prompt: "You are a helpful assistant",
      })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    const configMsg = JSON.parse(lastWs().sent[1] as string);
    expect(configMsg.prompt).toBe("You are a helpful assistant");
  });

  it("sets audioReady and isConnected after ready message", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.audioReady).toBe(false);
    expect(result.current.isConnected).toBe(false);

    act(() => {
      lastWs().simulateMessage({ type: "ready", sampleRate: 16000, ttsSampleRate: 24000 });
    });

    await vi.waitFor(() => expect(result.current.audioReady).toBe(true));
    expect(result.current.isConnected).toBe(true);
  });

  it("connect and disconnect control session", async () => {
    const { result } = renderHook(() =>
      useVoiceAgent({ apiKey: "pk_test", platformUrl: "ws://localhost:3000" })
    );

    await vi.waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      lastWs().simulateMessage({ type: "ready", sampleRate: 16000, ttsSampleRate: 24000 });
    });
    await vi.waitFor(() => expect(result.current.isConnected).toBe(true));

    // Disconnect
    act(() => {
      result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.audioReady).toBe(false);

    // Reconnect
    act(() => {
      result.current.connect();
    });

    await vi.waitFor(() => expect(lastWs().readyState).toBe(1));

    // Verify skipGreeting: configure message should have empty greeting
    const latestWs = lastWs();
    const configMsg = JSON.parse(latestWs.sent[1] as string);
    expect(configMsg.greeting).toBe("");
  });
});
