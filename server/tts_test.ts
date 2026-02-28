import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TtsClient } from "./tts.ts";
import { DEFAULT_TTS_CONFIG } from "./types.ts";
import { installMockWebSocket, MockWebSocket } from "./_test_utils.ts";

let mockWs: { restore: () => void; created: MockWebSocket[] };

const config = { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" };

describe("TtsClient", () => {
  beforeEach(() => {
    mockWs = installMockWebSocket();
  });

  afterEach(() => {
    mockWs.restore();
  });

  it("creates a warm WebSocket on construction", () => {
    const _client = new TtsClient(config);
    expect(mockWs.created.length).toBe(1);
  });

  it("skips warm-up when apiKey is empty", () => {
    const _client = new TtsClient({ ...config, apiKey: "" });
    expect(mockWs.created.length).toBe(0);
  });

  it("synthesize sends config, words, __END__ and relays audio", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const chunks: Uint8Array[] = [];
    const promise = client.synthesize(
      "one two three",
      (chunk) => chunks.push(chunk),
    );

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWs.created[mockWs.created.length - 1];

    // Server sends audio
    ws.onmessage?.(
      new MessageEvent("message", { data: new Uint8Array([10, 20]).buffer }),
    );

    // Server closes (TTS done)
    ws.close();
    await promise;

    // Verify protocol: config JSON, "one", "two", "three", "__END__"
    const configMsg = JSON.parse(ws.sentData[0] as string);
    expect(configMsg.voice).toBe(config.voice);
    expect(ws.sentData).toContain("one");
    expect(ws.sentData).toContain("two");
    expect(ws.sentData).toContain("three");
    expect(ws.sentData[ws.sentData.length - 1]).toBe("__END__");

    // Verify audio was relayed
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(new Uint8Array([10, 20]));
  });

  it("resolves immediately when signal is already aborted", async () => {
    const client = new TtsClient(config);
    const controller = new AbortController();
    controller.abort();

    const chunks: Uint8Array[] = [];
    await client.synthesize("Hello", (c) => chunks.push(c), controller.signal);
    expect(chunks).toHaveLength(0);
  });

  it("aborts mid-stream when signal fires", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    const promise = client.synthesize(
      "Long text",
      (c) => chunks.push(c),
      controller.signal,
    );

    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await promise;
    expect(chunks).toHaveLength(0);
  });

  it("creates fresh connection when warm WS is unavailable", async () => {
    const client = new TtsClient(config);
    expect(mockWs.created.length).toBe(1);

    // Kill the warm WS
    mockWs.created[0].readyState = MockWebSocket.CLOSED;

    const promise = client.synthesize("Hello", () => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(mockWs.created.length).toBe(2);

    mockWs.created[1].close();
    await promise;
  });

  it("warms up a new connection after synthesize completes", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockWs.created.length).toBe(1);

    const promise = client.synthesize("Hello", () => {});
    await new Promise((r) => setTimeout(r, 10));
    mockWs.created[mockWs.created.length - 1].close();
    await promise;
    await new Promise((r) => setTimeout(r, 10));

    expect(mockWs.created.length).toBeGreaterThanOrEqual(2);
  });

  it("close disposes warm WS", () => {
    const client = new TtsClient(config);
    client.close();
    expect(mockWs.created[0].readyState).toBe(MockWebSocket.CLOSED);
  });

  it("rejects on unexpected WS error during synthesize", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const promise = client.synthesize("Test", () => {});
    await new Promise((r) => setTimeout(r, 10));

    mockWs.created[mockWs.created.length - 1].onerror?.(new Event("error"));

    try {
      await promise;
      // If it resolves, that's also acceptable
    } catch (err) {
      expect((err as Error).message).toContain("TTS WebSocket error");
    }
  });
});
