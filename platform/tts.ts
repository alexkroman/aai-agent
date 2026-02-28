import { getLogger } from "../_utils/logger.ts";
import type { TTSConfig } from "./types.ts";

const log = getLogger("tts");

export interface ITtsClient {
  synthesize(
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
}

export type TtsWebSocketFactory = (config: TTSConfig) => WebSocket;

function createTtsWs(config: TTSConfig): WebSocket {
  // deno-lint-ignore no-explicit-any
  const ws = new (WebSocket as any)(config.wssUrl, {
    headers: { Authorization: `Api-Key ${config.apiKey}` },
  });
  ws.binaryType = "arraybuffer";
  return ws;
}

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

  private warmUp(): void {
    if (this.disposed || !this.config.apiKey) return;

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
    if (signal?.aborted) return Promise.resolve();

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
              log.warn("Failed to read TTS Blob audio", { error: err });
            });
        }
      };

      ws.onclose = (event: CloseEvent) => {
        signal?.removeEventListener("abort", onAbort);
        this.warmUp();
        if (event.code !== 1000 && event.code !== 1005) {
          reject(
            new Error(
              `TTS WebSocket closed unexpectedly (code ${event.code})`,
            ),
          );
        } else {
          resolve();
        }
      };

      ws.onerror = () => {
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        reject(new Error("TTS WebSocket error"));
      };
    });
  }
}
