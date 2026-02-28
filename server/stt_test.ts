import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { connectStt } from "./stt.ts";
import type { SttEvents } from "./stt.ts";
import { DEFAULT_STT_CONFIG } from "./types.ts";
import { installMockWebSocket, MockWebSocket } from "./_test_utils.ts";

let mockWs: { restore: () => void; created: MockWebSocket[] };

describe("connectStt", () => {
  beforeEach(() => {
    mockWs = installMockWebSocket();
  });

  afterEach(() => {
    mockWs.restore();
  });

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
      onTranscript(text: string, isFinal: boolean) {
        transcripts.push({ text, isFinal });
      },
      onTurn(text: string) {
        turns.push(text);
      },
      onError(err: Error) {
        errors.push(err);
      },
      onClose() {
        closed = true;
      },
    };
  }

  it("resolves with SttHandle on successful connection", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    expect(handle).toBeDefined();
    expect(typeof handle.send).toBe("function");
    expect(typeof handle.clear).toBe("function");
    expect(typeof handle.close).toBe("function");
  });

  it("handle.send sends data to WebSocket", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const data = new Uint8Array([1, 2, 3]);
    handle.send(data);
    expect(mockWs.created[0].sentData).toHaveLength(1);
  });

  it("handle.clear sends ForceEndpoint message", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.clear();
    const sent = mockWs.created[0].sentData;
    const forceEndpoint = sent.filter(
      (d): d is string => typeof d === "string",
    ).find((s) => JSON.parse(s).type === "ForceEndpoint");
    expect(forceEndpoint).toBeDefined();
  });

  it("handle.close closes WebSocket", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.close();
    expect(events.closed).toBe(true);
  });

  it("invokes onTranscript for Transcript messages", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "Transcript",
          transcript: "hello world",
          is_final: false,
        }),
      }),
    );

    expect(events.transcripts).toHaveLength(1);
    expect(events.transcripts[0].text).toBe("hello world");
    expect(events.transcripts[0].isFinal).toBe(false);
  });

  it("invokes onTranscript for final Transcript", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "Transcript",
          transcript: "final text",
          is_final: true,
        }),
      }),
    );

    expect(events.transcripts).toHaveLength(1);
    expect(events.transcripts[0].isFinal).toBe(true);
  });

  it("invokes onTurn for formatted Turn messages", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "Turn",
          transcript: "What is the weather?",
          turn_is_formatted: true,
        }),
      }),
    );

    expect(events.turns).toHaveLength(1);
    expect(events.turns[0]).toBe("What is the weather?");
  });

  it("sends transcript for unformatted Turn messages", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "Turn",
          transcript: "unformatted text",
          turn_is_formatted: false,
        }),
      }),
    );

    // Should call onTranscript instead of onTurn
    expect(events.turns).toHaveLength(0);
    expect(events.transcripts).toHaveLength(1);
    expect(events.transcripts[0].text).toBe("unformatted text");
  });

  it("skips Turn messages with empty transcript", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "Turn",
          transcript: "   ",
          turn_is_formatted: true,
        }),
      }),
    );

    expect(events.turns).toHaveLength(0);
    expect(events.transcripts).toHaveLength(0);
  });

  it("skips invalid messages without throwing", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    // Invalid JSON
    ws.onmessage?.(
      new MessageEvent("message", { data: "not json" }),
    );
    expect(events.transcripts).toHaveLength(0);

    // Non-string data
    ws.onmessage?.(
      new MessageEvent("message", { data: new ArrayBuffer(8) }),
    );
    expect(events.transcripts).toHaveLength(0);
  });

  it("invokes onError for WS errors", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    // Trigger error after connection
    ws.onerror?.(new Event("error"));
    expect(events.errors).toHaveLength(1);
  });

  it("invokes onClose for WS close", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.onclose?.(new CloseEvent("close", { code: 1006 }));
    expect(events.closed).toBe(true);
  });

  it("includes prompt in URL params when configured", async () => {
    const events = makeEvents();
    const configWithPrompt = {
      ...DEFAULT_STT_CONFIG,
      prompt: "Transcribe medical terms",
    };

    await connectStt("test-key", configWithPrompt, events);
    expect(mockWs.created[0].url).toContain("prompt=");
  });

  it("skips Zod-invalid messages", async () => {
    const events = makeEvents();

    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    // Valid JSON but fails schema validation
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "UnknownType", data: 123 }),
      }),
    );

    expect(events.transcripts).toHaveLength(0);
    expect(events.turns).toHaveLength(0);
  });

  it("handle.send is no-op when WS is closed", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    // Close the WS
    handle.close();
    // Sending after close should not throw
    handle.send(new Uint8Array([1]));
  });

  it("handle.clear is no-op when WS is closed", async () => {
    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.close();
    // Clearing after close should not throw
    handle.clear();
  });

  it("uses injectable createWebSocket factory", async () => {
    let factoryCalled = false;
    let capturedUrl = "";

    const factory = (
      url: string,
      opts: { headers: Record<string, string> },
    ) => {
      factoryCalled = true;
      capturedUrl = url;
      // Return a MockWebSocket-compatible object
      const ws = new MockWebSocket(url, opts);
      mockWs.created.push(ws);
      return ws as unknown as WebSocket;
    };

    const events = makeEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events, {
      createWebSocket: factory,
    });

    expect(factoryCalled).toBe(true);
    expect(capturedUrl).toContain("sample_rate=");
    expect(handle).toBeDefined();
  });
});
