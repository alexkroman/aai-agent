// tts.ts — TTS client (Orpheus WebSocket relay).

import WebSocket from "ws";
import type { TTSConfig } from "./types.js";

/**
 * Synthesize text via Orpheus TTS and stream PCM16 audio chunks.
 *
 * @param text - Cleaned text to synthesize.
 * @param config - TTS configuration.
 * @param onAudio - Called for each PCM16 audio chunk.
 * @param signal - AbortSignal for cancellation.
 * @returns Promise that resolves when TTS is complete.
 */
export async function synthesize(
  text: string,
  config: TTSConfig,
  onAudio: (chunk: Buffer) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const ws = new WebSocket(config.wssUrl, {
      headers: { Authorization: `Api-Key ${config.apiKey}` },
    });

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

    ws.on("open", () => {
      // Send TTS configuration
      ws.send(
        JSON.stringify({
          voice: config.voice,
          max_tokens: config.maxTokens,
          buffer_size: config.bufferSize,
          repetition_penalty: config.repetitionPenalty,
          temperature: config.temperature,
          top_p: config.topP,
        })
      );
      // Send text word by word
      for (const word of text.split(/\s+/)) {
        if (word) ws.send(word);
      }
      ws.send("__END__");
    });

    ws.on("message", (data) => {
      if (data instanceof Buffer) {
        onAudio(data);
      }
    });

    ws.on("close", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });

    ws.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      reject(err);
    });
  });
}
