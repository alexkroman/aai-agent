import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted so these are available in the vi.mock factory
const { instances } = vi.hoisted(() => {
  const instances: any[] = [];
  return { instances };
});

vi.mock("ws", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

    removeAllListeners() {
      super.removeAllListeners();
      return this;
    }

    on(event: string, fn: (...args: any[]) => void) {
      return super.on(event, fn);
    }
  }

  return { default: MockWS };
});

import { TtsClient } from "../tts.js";
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

describe("TtsClient", () => {
  beforeEach(() => {
    instances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pre-warms a connection on construction", () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);
    client.close();
  });

  it("connects with correct URL and auth header", async () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);

    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("hello", vi.fn());
    expect(instances.length).toBe(1);
    const ws = instances[0];
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    ws.emit("close");
    await p;

    expect(ws.url).toBe("wss://tts.example.com/ws");
    expect(ws.opts.headers).toEqual({
      Authorization: "Api-Key tts-key-123",
    });

    client.close();
  });

  it("sends config then words then __END__", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("hello world", vi.fn());
    const ws = instances[0];
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

    client.close();
  });

  it("calls onAudio for each Buffer message", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const onAudio = vi.fn();
    const p = client.synthesize("hi", onAudio);
    const ws = instances[0];

    const chunk1 = Buffer.from([1, 2, 3]);
    const chunk2 = Buffer.from([4, 5, 6]);
    ws.emit("message", chunk1);
    ws.emit("message", chunk2);

    expect(onAudio).toHaveBeenCalledTimes(2);
    expect(onAudio).toHaveBeenCalledWith(chunk1);
    expect(onAudio).toHaveBeenCalledWith(chunk2);

    ws.emit("close");
    await p;

    client.close();
  });

  it("ignores non-Buffer messages", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const onAudio = vi.fn();
    const p = client.synthesize("hi", onAudio);

    instances[0].emit("message", "not a buffer");
    expect(onAudio).not.toHaveBeenCalled();

    instances[0].emit("close");
    await p;

    client.close();
  });

  it("resolves on close", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("hi", vi.fn());
    instances[0].emit("close");
    await expect(p).resolves.toBeUndefined();

    client.close();
  });

  it("rejects on error", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("hi", vi.fn());
    instances[0].emit("error", new Error("connection failed"));
    await expect(p).rejects.toThrow("connection failed");

    client.close();
  });

  it("resolves immediately if signal already aborted", async () => {
    const client = new TtsClient(config);
    const controller = new AbortController();
    controller.abort();
    await expect(client.synthesize("hi", vi.fn(), controller.signal)).resolves.toBeUndefined();
    client.close();
  });

  it("resolves and cleans up on abort signal", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const controller = new AbortController();
    const p = client.synthesize("hi", vi.fn(), controller.signal);
    controller.abort();
    await expect(p).resolves.toBeUndefined();

    client.close();
  });

  it("handles multi-word text with extra spaces", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("  hello   beautiful  world  ", vi.fn());
    const ws = instances[0];
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const words = ws.sent.slice(1, -1);
    expect(words).toEqual(["hello", "beautiful", "world"]);

    ws.emit("close");
    await p;

    client.close();
  });

  it("uses pre-warmed connection for first synthesize", async () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);

    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("hello", vi.fn());
    expect(instances.length).toBe(1);

    const ws = instances[0];
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    ws.emit("close");
    await p;

    client.close();
  });

  it("pre-warms next connection after synthesis completes", async () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p = client.synthesize("hello", vi.fn());
    const ws = instances[0];
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    ws.emit("close");
    await p;

    expect(instances.length).toBe(2);

    client.close();
  });

  it("creates fresh connection if warm one is not available", async () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);

    instances[0].emit("error", new Error("warm failed"));

    const p = client.synthesize("hello", vi.fn());
    expect(instances.length).toBe(2);

    const ws = instances[1];
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    ws.emit("close");
    await p;

    client.close();
  });

  it("reuses warm connection for second call", async () => {
    const client = new TtsClient(config);
    await vi.waitFor(() => expect(instances[0].readyState).toBe(1));

    const p1 = client.synthesize("first", vi.fn());
    await vi.waitFor(() => expect(instances[0].sent.length).toBeGreaterThan(0));
    instances[0].emit("close");
    await p1;

    expect(instances.length).toBe(2);
    await vi.waitFor(() => expect(instances[1].readyState).toBe(1));

    const p2 = client.synthesize("second", vi.fn());
    expect(instances.length).toBe(2);
    await vi.waitFor(() => expect(instances[1].sent.length).toBeGreaterThan(0));
    instances[1].emit("close");
    await p2;

    client.close();
  });

  it("close() disposes warm connection and prevents new ones", async () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);

    client.close();

    expect(instances[0].readyState).toBe(3);
  });

  it("does not pre-warm if no API key", () => {
    const noKeyConfig = { ...config, apiKey: "" };
    const client = new TtsClient(noKeyConfig);
    expect(instances.length).toBe(0);
    client.close();
  });

  it("closes existing warm connection before creating a new one in warmUp", async () => {
    const client = new TtsClient(config);
    expect(instances.length).toBe(1);
    const firstWarm = instances[0];
    await vi.waitFor(() => expect(firstWarm.readyState).toBe(1));

    const p = client.synthesize("hello", vi.fn());
    await vi.waitFor(() => expect(firstWarm.sent.length).toBeGreaterThan(0));
    firstWarm.emit("close");
    await p;

    expect(instances.length).toBe(2);
    const secondWarm = instances[1];

    await vi.waitFor(() => expect(secondWarm.readyState).toBe(1));
    const p2 = client.synthesize("world", vi.fn());
    await vi.waitFor(() => expect(secondWarm.sent.length).toBeGreaterThan(0));
    secondWarm.emit("close");
    await p2;

    expect(instances.length).toBe(3);

    client.close();
    expect(instances[2].readyState).toBe(3);
  });
});
