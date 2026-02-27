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
    opts: unknown;

    constructor(url: string, opts?: unknown) {
      super();
      this.url = url;
      this.opts = opts;
      instances.push(this);
      queueMicrotask(() => this.emit("open"));
    }

    send(data: unknown) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }

  return { default: MockWS };
});

import { synthesize } from "../tts.js";
import type { TTSConfig } from "../types.js";

const config: TTSConfig = {
  wssUrl: "wss://tts.example.com/ws",
  apiKey: "tts-key-123",
  voice: "jess",
  maxTokens: 2000,
  bufferSize: 105,
  repetitionPenalty: 1.2,
  temperature: 0.6,
  topP: 0.9,
  sampleRate: 24000,
};

function lastWs() {
  return instances[instances.length - 1];
}

describe("synthesize", () => {
  beforeEach(() => {
    instances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects with correct URL and auth header", async () => {
    const p = synthesize("hello", config, vi.fn());
    await vi.waitFor(() => expect(instances.length).toBe(1));
    const ws = lastWs();
    ws.emit("close");
    await p;

    expect(ws.url).toBe("wss://tts.example.com/ws");
    expect(ws.opts.headers).toEqual({
      Authorization: "Api-Key tts-key-123",
    });
  });

  it("sends config then words then __END__ on open", async () => {
    const p = synthesize("hello world", config, vi.fn());
    await vi.waitFor(() => expect(instances.length).toBe(1));
    const ws = lastWs();
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const configMsg = JSON.parse(ws.sent[0] as string);
    expect(configMsg.voice).toBe("jess");
    expect(configMsg.max_tokens).toBe(2000);
    expect(configMsg.buffer_size).toBe(105);
    expect(configMsg.repetition_penalty).toBe(1.2);
    expect(configMsg.temperature).toBe(0.6);
    expect(configMsg.top_p).toBe(0.9);

    expect(ws.sent[1]).toBe("hello");
    expect(ws.sent[2]).toBe("world");
    expect(ws.sent[3]).toBe("__END__");

    ws.emit("close");
    await p;
  });

  it("calls onAudio for each Buffer message", async () => {
    const onAudio = vi.fn();
    const p = synthesize("hi", config, onAudio);
    await vi.waitFor(() => expect(instances.length).toBe(1));
    const ws = lastWs();

    const chunk1 = Buffer.from([1, 2, 3]);
    const chunk2 = Buffer.from([4, 5, 6]);
    ws.emit("message", chunk1);
    ws.emit("message", chunk2);

    expect(onAudio).toHaveBeenCalledTimes(2);
    expect(onAudio).toHaveBeenCalledWith(chunk1);
    expect(onAudio).toHaveBeenCalledWith(chunk2);

    ws.emit("close");
    await p;
  });

  it("ignores non-Buffer messages", async () => {
    const onAudio = vi.fn();
    const p = synthesize("hi", config, onAudio);
    await vi.waitFor(() => expect(instances.length).toBe(1));

    lastWs().emit("message", "not a buffer");
    expect(onAudio).not.toHaveBeenCalled();

    lastWs().emit("close");
    await p;
  });

  it("resolves on close", async () => {
    const p = synthesize("hi", config, vi.fn());
    await vi.waitFor(() => expect(instances.length).toBe(1));
    lastWs().emit("close");
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects on error", async () => {
    const p = synthesize("hi", config, vi.fn());
    await vi.waitFor(() => expect(instances.length).toBe(1));
    lastWs().emit("error", new Error("connection failed"));
    await expect(p).rejects.toThrow("connection failed");
  });

  it("resolves immediately if signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(synthesize("hi", config, vi.fn(), controller.signal)).resolves.toBeUndefined();
  });

  it("resolves and cleans up on abort signal", async () => {
    const controller = new AbortController();
    const p = synthesize("hi", config, vi.fn(), controller.signal);
    await vi.waitFor(() => expect(instances.length).toBe(1));
    controller.abort();
    await expect(p).resolves.toBeUndefined();
  });

  it("handles multi-word text with extra spaces", async () => {
    const p = synthesize("  hello   beautiful  world  ", config, vi.fn());
    await vi.waitFor(() => expect(instances.length).toBe(1));
    const ws = lastWs();
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    // First is config JSON, then words, then __END__
    const words = ws.sent.slice(1, -1);
    expect(words).toEqual(["hello", "beautiful", "world"]);

    ws.emit("close");
    await p;
  });
});
