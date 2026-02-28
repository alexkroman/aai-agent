// tts.ts — TTS client with connection pre-warming (Orpheus WebSocket relay).
// Deno-native: uses standard WebSocket API, Uint8Array instead of Buffer.

import { createLogger } from "./logger.ts";
import type { TTSConfig } from "./types.ts";
import { createDenoWebSocket } from "./deno-ext.ts";

const log = createLogger("tts");

/** Minimal interface for TTS client (enables test mocking without class internals). */
export interface ITtsClient {
  synthesize(
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
}

/** Factory for creating TTS WebSocket connections. */
export type TtsWebSocketFactory = (config: TTSConfig) => WebSocket;

/** Create an authenticated WebSocket to the TTS endpoint. */
function createTtsWs(config: TTSConfig): WebSocket {
  // Deno 2.5+ supports custom headers on client WebSocket connections
  const ws = createDenoWebSocket(config.wssUrl, {
    headers: { Authorization: `Api-Key ${config.apiKey}` },
  });
  ws.binaryType = "arraybuffer";
  return ws;
}

/**
 * TTS client that pre-warms WebSocket connections for lower latency.
 *
 * Usage:
 *   const client = new TtsClient(config);
 *   await client.synthesize("Hello!", onAudio, signal);
 *   client.close();
 */
export class TtsClient {
  private config: TTSConfig;
  private warmWs: WebSocket | null = null;
  private disposed = false;
  private createWs: TtsWebSocketFactory;

  constructor(config: TTSConfig, createWebSocket?: TtsWebSocketFactory) {
    this.config = config;
    this.createWs = createWebSocket ?? createTtsWs;
    this.warmUp();
  }

  /**
   * Pre-warm a WebSocket connection so it's ready when synthesize() is called.
   */
  private warmUp(): void {
    if (this.disposed || !this.config.apiKey) return;

    // Close existing warm connection before creating a new one
    if (this.warmWs) {
      try {
        this.warmWs.close();
      } catch {
        // ignore
      }
      this.warmWs = null;
    }

    let ws: WebSocket;
    try {
      ws = this.createWs(this.config);
    } catch (err) {
      log.warn({ error: err }, "warmUp: failed to create WebSocket");
      return;
    }

    ws.onerror = (e) => {
      const msg = e instanceof ErrorEvent ? e.message : "unknown";
      log.warn({ error: msg }, "warmUp failed");
      if (this.warmWs === ws) {
        this.warmWs = null;
      }
    };

    this.warmWs = ws;
  }

  /**
   * Synthesize text via Orpheus TTS and stream PCM16 audio chunks.
   */
  synthesize(
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return Promise.resolve();

    // Take the warm connection if open, otherwise create fresh
    let ws: WebSocket;
    if (this.warmWs && this.warmWs.readyState <= WebSocket.OPEN) {
      ws = this.warmWs;
      this.warmWs = null;
    } else {
      if (this.warmWs) {
        try {
          this.warmWs.close();
        } catch { /* ignore */ }
        this.warmWs = null;
      }
      ws = this.createWs(this.config);
    }

    return this.runTtsProtocol(ws, text, onAudio, signal);
  }

  /**
   * Close any pre-warmed connection and stop warming up.
   */
  close(): void {
    this.disposed = true;
    if (this.warmWs) {
      try {
        this.warmWs.close();
      } catch {
        // ignore
      }
      this.warmWs = null;
    }
  }

  /**
   * Run the Orpheus TTS WebSocket protocol on a given connection.
   */
  private runTtsProtocol(
    ws: WebSocket,
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };

      const onAbort = () => {
        cleanup();
        resolve();
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      const sendText = () => {
        ws.send(
          JSON.stringify({
            voice: this.config.voice,
            max_tokens: this.config.maxTokens,
            buffer_size: this.config.bufferSize,
            repetition_penalty: this.config.repetitionPenalty,
            temperature: this.config.temperature,
            top_p: this.config.topP,
          }),
        );
        for (const word of text.split(/\s+/)) {
          if (word) ws.send(word);
        }
        ws.send("__END__");
      };

      // If already open (warm connection), send immediately
      if (ws.readyState === WebSocket.OPEN) {
        sendText();
      } else {
        ws.onopen = sendText;
      }

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          onAudio(new Uint8Array(event.data));
        } else if (event.data instanceof Blob) {
          event.data.arrayBuffer()
            .then((buf) => onAudio(new Uint8Array(buf)))
            .catch((err) => {
              log.warn({ error: err }, "Failed to read TTS Blob audio");
            });
        }
      };

      ws.onclose = () => {
        signal?.removeEventListener("abort", onAbort);
        this.warmUp();
        resolve();
      };

      ws.onerror = () => {
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        reject(new Error("TTS WebSocket error"));
      };
    });
  }
}
