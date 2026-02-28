import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { connectStt, type SttEvents } from "./stt.ts";
import { DEFAULT_STT_CONFIG } from "./types.ts";
import { installMockWebSocket, MockWebSocket } from "./_test_utils.ts";

let mockWs: { restore: () => void; created: MockWebSocket[] };

function makeEvents(): SttEvents & {
  transcripts: { text: string; isFinal: boolean }[];
  turns: string[];
  errors: Error[];
  closed: boolean;
} {
  const transcripts: { text: string; isFinal: boolean }[] = [];
  const turns: string[] = [];
  const errors: Error[] = [];
  let closed = false;

  return {
    transcripts,
    turns,
    errors,
    get closed() {
      return closed;
    },
    onTranscript(text, isFinal) {
      transcripts.push({ text, isFinal });
    },
    onTurn(text) {
      turns.push(text);
    },
    onError(err) {
      errors.push(err);
    },
    onClose() {
      closed = true;
    },
  };
}

function sendMsg(ws: MockWebSocket, data: Record<string, unknown>) {
  ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
}

describe("connectStt", () => {
  beforeEach(() => {
    mockWs = installMockWebSocket();
  });

  afterEach(() => {
    mockWs.restore();
  });

  it("handle.send relays audio to WebSocket", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.send(new Uint8Array([1, 2, 3]));
    expect(mockWs.created[0].sentData).toHaveLength(1);
  });

  it("handle.clear sends ForceEndpoint", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.clear();
    const sent = mockWs.created[0].sentData
      .filter((d): d is string => typeof d === "string");
    expect(sent.some((s) => JSON.parse(s).type === "ForceEndpoint")).toBe(true);
  });

  it("handle.close closes WebSocket", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.close();
    expect(events.closed).toBe(true);
  });

  it("dispatches Transcript messages", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    sendMsg(ws, { type: "Transcript", transcript: "hello", is_final: false });
    sendMsg(ws, { type: "Transcript", transcript: "world", is_final: true });

    expect(events.transcripts).toHaveLength(2);
    expect(events.transcripts[0]).toEqual({ text: "hello", isFinal: false });
    expect(events.transcripts[1]).toEqual({ text: "world", isFinal: true });
  });

  it("dispatches formatted Turn as onTurn", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "What is the weather?",
      turn_is_formatted: true,
    });

    expect(events.turns).toEqual(["What is the weather?"]);
  });

  it("dispatches unformatted Turn as onTranscript", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "unformatted text",
      turn_is_formatted: false,
    });

    expect(events.turns).toHaveLength(0);
    expect(events.transcripts[0].text).toBe("unformatted text");
  });

  it("skips Turn with empty transcript", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "   ",
      turn_is_formatted: true,
    });

    expect(events.turns).toHaveLength(0);
    expect(events.transcripts).toHaveLength(0);
  });

  it("skips invalid and non-string messages", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onmessage?.(new MessageEvent("message", { data: "not json" }));
    ws.onmessage?.(new MessageEvent("message", { data: new ArrayBuffer(8) }));
    sendMsg(ws, { type: "UnknownType", data: 123 });

    expect(events.transcripts).toHaveLength(0);
    expect(events.turns).toHaveLength(0);
  });

  it("fires onError on WebSocket error", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    mockWs.created[0].onerror?.(new Event("error"));
    expect(events.errors).toHaveLength(1);
  });

  it("fires onClose on unexpected WebSocket close", async () => {
    const events = makeEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    mockWs.created[0].onclose?.(new CloseEvent("close", { code: 1006 }));
    expect(events.closed).toBe(true);
    expect(events.errors).toHaveLength(1);
  });

  it("includes prompt in URL when configured", async () => {
    const events = makeEvents();
    await connectStt("test-key", {
      ...DEFAULT_STT_CONFIG,
      prompt: "Transcribe medical terms",
    }, events);
    expect(mockWs.created[0].url).toContain("prompt=");
  });
});
