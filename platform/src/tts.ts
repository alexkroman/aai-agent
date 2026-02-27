// tts.ts — TTS client with connection pre-warming (Orpheus WebSocket relay).
//
// The Orpheus TTS protocol is one-shot: connect → config → words → __END__ →
// audio chunks → server closes. We can't reuse a connection, but we CAN
// pre-warm the next connection while the current one is still streaming audio.
// This eliminates the 100-500ms connection setup time on every turn after the first.

import WebSocket from "ws";
import { createLogger } from "./logger.js";
import type { TTSConfig } from "./types.js";

const log = createLogger("tts");

/**
 * Safely close a WebSocket, absorbing any async 'error' events emitted
 * during close (e.g. when closing a CONNECTING WebSocket, `ws` emits the
 * error via process.nextTick after `abortHandshake`).
 */
function safeCloseWs(ws: WebSocket): void {
  ws.removeAllListeners();
  ws.on("error", () => {}); // absorb async error from close()
  ws.close();
}

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

    // Close existing warm connection before creating a new one
    if (this.warmWs) {
      safeCloseWs(this.warmWs);
      this.warmWs = null;
    }

    const ws = new WebSocket(this.config.wssUrl, {
      headers: { Authorization: `Api-Key ${this.config.apiKey}` },
    });

    ws.on("error", (err: Error) => {
      log.warn({ err }, "warmUp failed");
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

    return this.runTtsProtocol(ws, text, onAudio, signal);
  }

  /**
   * Close any pre-warmed connection and stop warming up.
   */
  close(): void {
    this.disposed = true;
    if (this.warmWs) {
      safeCloseWs(this.warmWs);
      this.warmWs = null;
    }
  }

  /**
   * Run the Orpheus TTS WebSocket protocol on a given connection.
   * Shared logic for both warm and fresh connections.
   */
  private runTtsProtocol(
    ws: WebSocket,
    text: string,
    onAudio: (chunk: Buffer) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        safeCloseWs(ws);
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
          })
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
        ws.on("open", sendText);
      }

      ws.on("message", (data) => {
        if (data instanceof Buffer) {
          onAudio(data);
        }
      });

      ws.on("close", () => {
        signal?.removeEventListener("abort", onAbort);
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
}
