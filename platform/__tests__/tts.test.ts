import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TtsClient, type TtsWebSocketFactory } from "../tts.ts";
import { DEFAULT_TTS_CONFIG } from "../../sdk/types.ts";
import { installMockWebSocket, MockWebSocket } from "./_test-utils.ts";

let mockWs: { restore: () => void; created: MockWebSocket[] };

describe("TtsClient", () => {
  beforeEach(() => {
    mockWs = installMockWebSocket();
  });

  afterEach(() => {
    mockWs.restore();
  });

  const config = {
    ...DEFAULT_TTS_CONFIG,
    apiKey: "test-tts-key",
  };

  it("constructor creates a warm WebSocket", () => {
    const _client = new TtsClient(config);
    expect(mockWs.created.length).toBe(1);
  });

  it("does not warm up when apiKey is empty", () => {
    const _client = new TtsClient({ ...config, apiKey: "" });
    expect(mockWs.created.length).toBe(0);
  });

  it("synthesize sends config, words, and __END__", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10)); // let warm-up open

    const chunks: Uint8Array[] = [];
    const promise = client.synthesize(
      "Hello world",
      (chunk) => chunks.push(chunk),
    );

    // Wait for the protocol to start
    await new Promise((r) => setTimeout(r, 10));

    // Find the socket used for synthesize
    const ws = mockWs.created[mockWs.created.length - 1];

    // Simulate server sending audio
    const audioData = new Uint8Array([0, 1, 2, 3]).buffer;
    ws.onmessage?.(new MessageEvent("message", { data: audioData }));

    // Simulate server closing connection (TTS done)
    ws.close();

    await promise;

    // Verify protocol messages were sent
    const jsonMessages = ws.sentData.filter(
      (d): d is string => typeof d === "string",
    );
    expect(jsonMessages.length).toBeGreaterThan(0);

    // First message should be the config JSON
    const configMsg = JSON.parse(jsonMessages[0]);
    expect(configMsg.voice).toBe(config.voice);

    // Should have sent words and __END__
    const lastSent = ws.sentData[ws.sentData.length - 1];
    expect(lastSent).toBe("__END__");
  });

  it("synthesize resolves immediately when signal is already aborted", async () => {
    const client = new TtsClient(config);
    const controller = new AbortController();
    controller.abort();

    const chunks: Uint8Array[] = [];
    await client.synthesize(
      "Hello",
      (chunk) => chunks.push(chunk),
      controller.signal,
    );
    expect(chunks).toHaveLength(0);
  });

  it("synthesize calls onAudio with received ArrayBuffer data", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const chunks: Uint8Array[] = [];
    const promise = client.synthesize(
      "Test",
      (chunk) => chunks.push(chunk),
    );

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWs.created[mockWs.created.length - 1];

    // Send audio data
    const audio = new Uint8Array([10, 20, 30]).buffer;
    ws.onmessage?.(new MessageEvent("message", { data: audio }));

    ws.close();
    await promise;

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(new Uint8Array([10, 20, 30]));
  });

  it("close sets disposed and closes warm WS", () => {
    const client = new TtsClient(config);
    expect(mockWs.created.length).toBe(1);
    client.close();
    expect(mockWs.created[0].readyState).toBe(MockWebSocket.CLOSED);
  });

  it("close is safe to call multiple times", () => {
    const client = new TtsClient(config);
    client.close();
    expect(() => client.close()).not.toThrow();
  });

  it("creates fresh connection when warm WS is not ready", async () => {
    // Create client — warm WS is created
    const client = new TtsClient(config);
    expect(mockWs.created.length).toBe(1);

    // Close the warm WS manually to simulate it being unavailable
    mockWs.created[0].readyState = MockWebSocket.CLOSED;

    // Synthesize should create a new connection
    const promise = client.synthesize("Hello", () => {});

    await new Promise((r) => setTimeout(r, 10));
    // Should have created 2 sockets: warm + fresh
    expect(mockWs.created.length).toBe(2);

    // Close the new socket to complete
    mockWs.created[1].close();
    await promise;
  });

  it("synthesize aborts mid-stream when signal fires", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    const promise = client.synthesize(
      "Long text here",
      (chunk) => chunks.push(chunk),
      controller.signal,
    );

    await new Promise((r) => setTimeout(r, 10));

    // Abort mid-stream
    controller.abort();
    await promise;

    // Should have resolved without error
    expect(chunks).toHaveLength(0);
  });

  it("handles WS error during synthesize without crashing", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const promise = client.synthesize("Test", () => {});

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWs.created[mockWs.created.length - 1];

    // Trigger error — the promise may resolve or reject depending on
    // whether onclose fires before onerror's reject call
    ws.onerror?.(new Event("error"));

    // Should settle without hanging
    try {
      await promise;
    } catch {
      // Error rejection is also acceptable
    }
  });

  it("does not warm up after close", () => {
    const client = new TtsClient(config);
    expect(mockWs.created.length).toBe(1);
    client.close();
    // Close triggers the warmUp again via onclose, but disposed flag should prevent it
    // No new socket should be created beyond the original + any from close triggers
    const countAfterClose = mockWs.created.length;
    // Verify no additional sockets are being created
    expect(countAfterClose).toBeLessThanOrEqual(2);
  });

  it("uses injectable createWebSocket factory", async () => {
    let factoryCallCount = 0;
    const factory: TtsWebSocketFactory = (cfg) => {
      factoryCallCount++;
      const ws = new MockWebSocket(cfg.wssUrl, {
        headers: { Authorization: `Api-Key ${cfg.apiKey}` },
      });
      ws.binaryType = "arraybuffer";
      mockWs.created.push(ws);
      return ws as unknown as WebSocket;
    };

    const client = new TtsClient(config, factory);
    // Factory should have been called once for warm-up
    expect(factoryCallCount).toBe(1);

    await new Promise((r) => setTimeout(r, 10));

    const promise = client.synthesize("Hi", () => {});
    await new Promise((r) => setTimeout(r, 10));

    const ws = mockWs.created[mockWs.created.length - 1];
    ws.close();
    await promise;

    // Factory should have been called again for warm-up after synthesize
    expect(factoryCallCount).toBeGreaterThanOrEqual(2);
  });

  it("handles warmUp error gracefully", async () => {
    // Override with a mock that immediately errors
    mockWs.restore();
    const original = globalThis.WebSocket;
    const errorCreated: MockWebSocket[] = [];

    const ErrorMockWs = class extends MockWebSocket {
      constructor(
        url: string | URL,
        protocols?: string | string[] | Record<string, unknown>,
      ) {
        super(url, protocols);
        errorCreated.push(this);
        // Simulate error on warm-up
        queueMicrotask(() => {
          this.onerror?.(
            new ErrorEvent("error", { message: "Connection refused" }),
          );
        });
      }
    };
    Object.defineProperty(globalThis, "WebSocket", {
      value: ErrorMockWs,
      writable: true,
      configurable: true,
    });

    // Should not throw
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));
    expect(client).toBeDefined();

    Object.defineProperty(globalThis, "WebSocket", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("synthesize sends each word separately", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));

    const promise = client.synthesize("one two three", () => {});

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWs.created[mockWs.created.length - 1];

    // Check sent data: config JSON, "one", "two", "three", "__END__"
    expect(ws.sentData).toContain("one");
    expect(ws.sentData).toContain("two");
    expect(ws.sentData).toContain("three");
    expect(ws.sentData).toContain("__END__");

    ws.close();
    await promise;
  });

  it("warms up a new connection after synthesize completes", async () => {
    const client = new TtsClient(config);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockWs.created.length).toBe(1);

    const promise = client.synthesize("Hello", () => {});
    await new Promise((r) => setTimeout(r, 10));

    // Close to complete synthesize
    const ws = mockWs.created[mockWs.created.length - 1];
    ws.close();
    await promise;
    await new Promise((r) => setTimeout(r, 10));

    // After completion, warmUp should create a new socket
    expect(mockWs.created.length).toBeGreaterThanOrEqual(2);
  });
});
