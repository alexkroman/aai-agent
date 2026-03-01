import { getLogger } from "../_utils/logger.ts";
import type { TTSConfig } from "./types.ts";

const log = getLogger("tts");

function safeClose(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    // ignore
  }
}

export interface ITtsClient {
  synthesize(
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
}

export class TtsClient {
  private config: TTSConfig;
  private warmWs: WebSocket | null = null;
  private disposed = false;

  constructor(config: TTSConfig) {
    this.config = config;
    this.warmUp();
  }

  private createWs(): WebSocket {
    // deno-lint-ignore no-explicit-any
    const ws = new (WebSocket as any)(this.config.wssUrl, {
      headers: { Authorization: `Api-Key ${this.config.apiKey}` },
    });
    ws.binaryType = "arraybuffer";
    return ws;
  }

  private warmUp(): void {
    if (this.disposed || !this.config.apiKey) return;

    if (this.warmWs) {
      safeClose(this.warmWs);
      this.warmWs = null;
    }

    let ws: WebSocket;
    try {
      ws = this.createWs();
    } catch (err) {
      log.warn("warmUp: failed to create WebSocket", { error: err });
      return;
    }

    ws.onerror = (e) => {
      const msg = e instanceof ErrorEvent ? e.message : "unknown";
      log.warn("warmUp failed", { error: msg });
      if (this.warmWs === ws) this.warmWs = null;
    };

    this.warmWs = ws;
  }

  synthesize(
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      log.info("synthesize skipped (already aborted)");
      return Promise.resolve();
    }

    log.info("synthesize start", {
      textLength: text.length,
      text: text.length > 200 ? text.slice(0, 200) + "…" : text,
      voice: this.config.voice,
    });

    let ws: WebSocket;
    if (this.warmWs && this.warmWs.readyState <= WebSocket.OPEN) {
      ws = this.warmWs;
      this.warmWs = null;
      log.info("using warm WebSocket");
    } else {
      if (this.warmWs) {
        safeClose(this.warmWs);
        this.warmWs = null;
      }
      ws = this.createWs();
      log.info("created new WebSocket");
    }

    return this.runTtsProtocol(ws, text, onAudio, signal);
  }

  close(): void {
    this.disposed = true;
    if (this.warmWs) {
      safeClose(this.warmWs);
      this.warmWs = null;
    }
  }

  private runTtsProtocol(
    ws: WebSocket,
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => safeClose(ws);

      let chunkCount = 0;
      let totalBytes = 0;

      const onAbort = () => {
        log.info("TTS aborted", { chunkCount, totalBytes });
        cleanup();
        resolve();
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      const sendText = () => {
        log.info("TTS sending text to WebSocket", {
          wordCount: text.split(/\s+/).filter(Boolean).length,
        });
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

      if (ws.readyState === WebSocket.OPEN) {
        sendText();
      } else {
        ws.onopen = sendText;
      }

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          chunkCount++;
          totalBytes += event.data.byteLength;
          onAudio(new Uint8Array(event.data));
        } else if (event.data instanceof Blob) {
          chunkCount++;
          totalBytes += event.data.size;
          event.data.arrayBuffer()
            .then((buf) => onAudio(new Uint8Array(buf)))
            .catch((err) => {
              log.warn("Failed to read TTS Blob audio", { error: err });
            });
        }
      };

      ws.onclose = (event: CloseEvent) => {
        signal?.removeEventListener("abort", onAbort);
        this.warmUp();
        if (event.code !== 1000 && event.code !== 1005) {
          log.error("TTS WebSocket closed unexpectedly", {
            code: event.code,
            reason: event.reason,
            chunkCount,
            totalBytes,
          });
          reject(
            new Error(
              `TTS WebSocket closed unexpectedly (code ${event.code})`,
            ),
          );
        } else {
          log.info("TTS complete", { code: event.code, chunkCount, totalBytes });
          resolve();
        }
      };

      ws.onerror = () => {
        log.error("TTS WebSocket error", { chunkCount, totalBytes });
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        reject(new Error("TTS WebSocket error"));
      };
    });
  }
}
