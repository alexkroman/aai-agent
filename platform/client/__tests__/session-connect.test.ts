import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubBrowserGlobals, resetWsInstances } from "./_mocks.js";
import { createSession, lastWs } from "./_session-helpers.js";

stubBrowserGlobals();

describe("VoiceSession — connect", () => {
  beforeEach(() => {
    resetWsInstances();
    vi.clearAllMocks();
  });

  it("creates WebSocket with URL (no API key in query string)", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    expect(lastWs().url).toBe("ws://localhost:3000/session");
  });

  it("sends authenticate message first, then configure", async () => {
    const { session, stateChanges } = createSession({
      instructions: "Be helpful",
      greeting: "Hello!",
      voice: "luna",
    });

    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const ws = lastWs();
    expect(ws.sent.length).toBeGreaterThanOrEqual(2);
    const authMsg = JSON.parse(ws.sent[0] as string);
    expect(authMsg.type).toBe("authenticate");
    expect(authMsg.apiKey).toBe("pk_test");

    const configMsg = JSON.parse(ws.sent[1] as string);
    expect(configMsg.type).toBe("configure");
    expect(configMsg.instructions).toBe("Be helpful");
    expect(configMsg.greeting).toBe("Hello!");
    expect(configMsg.voice).toBe("luna");
  });

  it("sets binaryType to arraybuffer", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));
  });

  it("sends tools in configure message", async () => {
    const { session, stateChanges } = createSession({
      tools: {
        get_weather: {
          description: "Get weather",
          parameters: { city: "string" },
          handler: async (args: any) => `Sunny in ${args.city}`,
        },
      },
    });

    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const configMsg = JSON.parse(lastWs().sent[1] as string);
    expect(configMsg.tools).toHaveLength(1);
    expect(configMsg.tools[0].name).toBe("get_weather");
    expect(configMsg.tools[0].handler).toContain("Sunny");
  });

  it("uses default voice 'jess' when none specified", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const configMsg = JSON.parse(lastWs().sent[1] as string);
    expect(configMsg.voice).toBe("jess");
  });

  it("fires onStateChange('ready') on open", async () => {
    const { session, stateChanges } = createSession();
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));
  });

  it("uses flat instructions/greeting/voice fields", async () => {
    const { session, stateChanges } = createSession({
      instructions: "flat instructions",
      greeting: "flat greeting",
      voice: "flat-voice",
    });
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const configMsg = JSON.parse(lastWs().sent[1] as string);
    expect(configMsg.instructions).toBe("flat instructions");
    expect(configMsg.greeting).toBe("flat greeting");
    expect(configMsg.voice).toBe("flat-voice");
  });

  it("uses empty defaults when fields are absent", async () => {
    const { session, stateChanges } = createSession({});
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    const configMsg = JSON.parse(lastWs().sent[1] as string);
    expect(configMsg.instructions).toBe("");
    expect(configMsg.greeting).toBe("");
    expect(configMsg.voice).toBe("jess");
  });

  it("uses default platformUrl when none specified", async () => {
    const { session, stateChanges } = createSession({ platformUrl: undefined });
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    expect(lastWs().url).toContain("wss://platform.example.com/session");
  });

  it("auto-converts HTTP platformUrl to WS", async () => {
    const { session, stateChanges } = createSession({
      platformUrl: "http://localhost:3000",
    });
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    expect(lastWs().url).toBe("ws://localhost:3000/session");
  });

  it("auto-converts HTTPS platformUrl to WSS", async () => {
    const { session, stateChanges } = createSession({
      platformUrl: "https://my-platform.com",
    });
    session.connect();
    await vi.waitFor(() => expect(stateChanges).toContain("ready"));

    expect(lastWs().url).toBe("wss://my-platform.com/session");
  });
});
