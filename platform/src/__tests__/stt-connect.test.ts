import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted so these are available in the vi.mock factory
const { instances } = vi.hoisted(() => {
  const instances: any[] = [];
  return { instances };
});

vi.mock("ws", () => {
  const { EventEmitter } = require("events");

  class MockWS extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    sent: unknown[] = [];
    url: string;

    constructor(url: string) {
      super();
      this.url = url;
      instances.push(this);
      queueMicrotask(() => this.emit("open"));
    }

    send(data: unknown) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
    }
  }

  return { default: MockWS };
});

import { connectStt } from "../stt.js";
import type { STTConfig } from "../types.js";

const sttConfig: STTConfig = {
  sampleRate: 16000,
  speechModel: "u3-pro",
  wssBase: "wss://streaming.assemblyai.com/v3/ws",
  tokenExpiresIn: 480,
  formatTurns: true,
  minEndOfTurnSilenceWhenConfident: 400,
  maxTurnSilence: 1200,
};

const mockFetch = vi.fn();

function makeEvents() {
  const transcripts: { text: string; isFinal: boolean }[] = [];
  const turns: string[] = [];
  const errors: Error[] = [];
  let closeCount = 0;
  return {
    transcripts,
    turns,
    errors,
    get closeCount() {
      return closeCount;
    },
    onTranscript: (text: string, isFinal: boolean) => transcripts.push({ text, isFinal }),
    onTurn: (text: string) => turns.push(text),
    onError: (err: Error) => errors.push(err),
    onClose: () => {
      closeCount++;
    },
  };
}

function lastWs() {
  return instances[instances.length - 1];
}

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ token: "test-stt-token" }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connectStt", () => {
  it("fetches token then connects WebSocket with correct params", async () => {
    const events = makeEvents();
    const handle = await connectStt("api-key-123", sttConfig, events);

    expect(mockFetch).toHaveBeenCalledOnce();
    const tokenUrl = mockFetch.mock.calls[0][0].toString();
    expect(tokenUrl).toContain("expires_in_seconds=480");

    const ws = lastWs();
    expect(ws.url).toContain("wss://streaming.assemblyai.com/v3/ws?");
    expect(ws.url).toContain("sample_rate=16000");
    expect(ws.url).toContain("speech_model=u3-pro");
    expect(ws.url).toContain("token=test-stt-token");
    expect(ws.url).toContain("format_turns=true");

    expect(handle.send).toBeTypeOf("function");
    expect(handle.clear).toBeTypeOf("function");
    expect(handle.close).toBeTypeOf("function");
  });

  it("returns a handle that sends audio to the WebSocket", async () => {
    const events = makeEvents();
    const handle = await connectStt("key", sttConfig, events);

    const audio = Buffer.from([10, 20, 30]);
    handle.send(audio);

    expect(lastWs().sent).toEqual([audio]);
  });

  it("handle.clear sends clear operation message", async () => {
    const events = makeEvents();
    const handle = await connectStt("key", sttConfig, events);

    handle.clear();
    expect(lastWs().sent).toEqual([JSON.stringify({ operation: "clear" })]);
  });

  it("handle.close closes the WebSocket", async () => {
    const events = makeEvents();
    const handle = await connectStt("key", sttConfig, events);

    const closeSpy = vi.spyOn(lastWs(), "close");
    handle.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("calls onTranscript for Transcript messages", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit(
      "message",
      JSON.stringify({
        type: "Transcript",
        transcript: "hello world",
        is_final: true,
      })
    );

    expect(events.transcripts).toEqual([{ text: "hello world", isFinal: true }]);
  });

  it("calls onTranscript for partial Transcript", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit(
      "message",
      JSON.stringify({
        type: "Transcript",
        transcript: "hel",
        is_final: false,
      })
    );

    expect(events.transcripts).toEqual([{ text: "hel", isFinal: false }]);
  });

  it("calls onTurn for formatted Turn messages", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit(
      "message",
      JSON.stringify({
        type: "Turn",
        transcript: "What is the weather?",
        turn_is_formatted: true,
      })
    );

    expect(events.turns).toEqual(["What is the weather?"]);
  });

  it("sends partial Turn as transcript instead of turn", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit(
      "message",
      JSON.stringify({
        type: "Turn",
        transcript: "What is",
        turn_is_formatted: false,
      })
    );

    expect(events.turns).toEqual([]);
    expect(events.transcripts).toEqual([{ text: "What is", isFinal: false }]);
  });

  it("ignores Turn with empty transcript", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit(
      "message",
      JSON.stringify({
        type: "Turn",
        transcript: "  ",
        turn_is_formatted: true,
      })
    );

    expect(events.turns).toEqual([]);
    expect(events.transcripts).toEqual([]);
  });

  it("skips binary messages", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit("message", Buffer.from([1, 2, 3]));

    expect(events.transcripts).toEqual([]);
    expect(events.turns).toEqual([]);
  });

  it("ignores unparseable JSON messages", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit("message", "not json {{{");

    expect(events.transcripts).toEqual([]);
    expect(events.errors).toEqual([]);
  });

  it("calls onError on WebSocket error", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit("error", new Error("socket broken"));
    expect(events.errors).toHaveLength(1);
    expect(events.errors[0].message).toBe("socket broken");
  });

  it("calls onClose on WebSocket close", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit("close");
    expect(events.closeCount).toBe(1);
  });

  it("does not send audio when WebSocket is not OPEN", async () => {
    const events = makeEvents();
    const handle = await connectStt("key", sttConfig, events);

    lastWs().readyState = 3; // CLOSED
    handle.send(Buffer.from([1]));

    expect(lastWs().sent).toEqual([]);
  });

  it("handles missing fields in Transcript gracefully", async () => {
    const events = makeEvents();
    await connectStt("key", sttConfig, events);

    lastWs().emit("message", JSON.stringify({ type: "Transcript" }));

    expect(events.transcripts).toEqual([{ text: "", isFinal: false }]);
  });
});
