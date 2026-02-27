// tts.ts — TTS client with connection pre-warming (Orpheus WebSocket relay).
//
// The Orpheus TTS protocol is one-shot: connect → config → words → __END__ →
// audio chunks → server closes. We can't reuse a connection, but we CAN
// pre-warm the next connection while the current one is still streaming audio.
// This eliminates the 100-500ms connection setup time on every turn after the first.

import WebSocket from "ws";
import type { TTSConfig } from "./types.js";

/**
 * TTS client that pre-warms WebSocket connections for lower latency.
 *
 * Usage:
 *   const client = new TtsClient(config);
 *   await client.synthesize("Hello!", onAudio, signal);
 *   await client.synthesize("Next turn!", onAudio, signal);
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

    const ws = new WebSocket(this.config.wssUrl, {
      headers: { Authorization: `Api-Key ${this.config.apiKey}` },
    });

    // Discard silently on error during warm-up
    ws.on("error", () => {
      if (this.warmWs === ws) {
        this.warmWs = null;
      }
    });

    this.warmWs = ws;
  }

  /**
   * Synthesize text via Orpheus TTS and stream PCM16 audio chunks.
   * Uses a pre-warmed connection if available, otherwise connects fresh.
   * Pre-warms the next connection once synthesis completes.
   */
  async synthesize(
    text: string,
    onAudio: (chunk: Buffer) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return;

    // Take the warm connection or create a fresh one
    let ws: WebSocket;
    if (this.warmWs) {
      ws = this.warmWs;
      this.warmWs = null;
    } else {
      ws = new WebSocket(this.config.wssUrl, {
        headers: { Authorization: `Api-Key ${this.config.apiKey}` },
      });
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      const onAbort = () => {
        cleanup();
        resolve();
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      const sendText = () => {
        // Send TTS configuration
        ws.send(
          JSON.stringify({
            voice: this.config.voice,
            max_tokens: this.config.maxTokens,
            buffer_size: this.config.bufferSize,
            repetition_penalty: this.config.repetitionPenalty,
            temperature: this.config.temperature,
            top_p: this.config.topP,
          })
        );
        // Send text word by word
        for (const word of text.split(/\s+/)) {
          if (word) ws.send(word);
        }
        ws.send("__END__");
      };

      // If already open (warm connection), send immediately
      if (ws.readyState === WebSocket.OPEN) {
        sendText();
      } else {
        ws.on("open", sendText);
      }

      ws.on("message", (data) => {
        if (data instanceof Buffer) {
          onAudio(data);
        }
      });

      ws.on("close", () => {
        signal?.removeEventListener("abort", onAbort);
        // Pre-warm the next connection
        this.warmUp();
        resolve();
      });

      ws.on("error", (err) => {
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Close any pre-warmed connection and stop warming up.
   */
  close(): void {
    this.disposed = true;
    if (this.warmWs) {
      try {
        this.warmWs.removeAllListeners();
        this.warmWs.close();
      } catch {
        // Already closed
      }
      this.warmWs = null;
    }
  }
}

/**
 * Synthesize text via Orpheus TTS (standalone, no connection reuse).
 * Kept for backward compatibility and simple use cases.
 */
export async function synthesize(
  text: string,
  config: TTSConfig,
  onAudio: (chunk: Buffer) => void,
  signal?: AbortSignal
): Promise<void> {
  const client = new TtsClient(config);
  try {
    await client.synthesize(text, onAudio, signal);
  } finally {
    client.close();
  }
}
