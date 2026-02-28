// tts.ts — TTS client with connection pre-warming (Orpheus WebSocket relay).
// Deno-native: uses standard WebSocket API, Uint8Array instead of Buffer.

import { createLogger } from "./logger.ts";
import type { TTSConfig } from "./types.ts";

const log = createLogger("tts");

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

  constructor(config: TTSConfig) {
    this.config = config;
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

    const ws = new WebSocket(this.config.wssUrl, [
      "Authorization",
      `Api-Key ${this.config.apiKey}`,
    ]);

    ws.onerror = () => {
      log.warn("warmUp failed");
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

    // Take the warm connection or create a fresh one
    let ws: WebSocket;
    if (this.warmWs) {
      ws = this.warmWs;
      this.warmWs = null;
    } else {
      ws = new WebSocket(this.config.wssUrl, [
        "Authorization",
        `Api-Key ${this.config.apiKey}`,
      ]);
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
          event.data.arrayBuffer().then((buf) => onAudio(new Uint8Array(buf)));
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
