// stt.ts — AssemblyAI streaming STT WebSocket client.
// Deno-native: uses standard WebSocket API with Authorization header (Deno 2.5+).
// No temp tokens needed — server-side connections auth directly with the API key.

import { deadline } from "@std/async/deadline";
import { TIMEOUTS } from "../sdk/shared-protocol.ts";
import { ERR_INTERNAL } from "../sdk/errors.ts";
import { createLogger } from "../sdk/logger.ts";
import { type STTConfig, SttMessageSchema } from "../sdk/types.ts";
import { createDenoWebSocket } from "./deno-ext.ts";

const log = createLogger("stt");

/** Factory for creating STT WebSocket connections. */
export type SttWebSocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket;

/** Callbacks for STT events (transcripts, completed turns, errors, close). */
export interface SttEvents {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurn: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/** Handle returned by connectStt. */
export interface SttHandle {
  send: (audio: Uint8Array) => void;
  clear: () => void;
  close: () => void;
}

/**
 * Connect a single STT WebSocket using the API key directly.
 */
async function connectSttWs(
  apiKey: string,
  config: STTConfig,
  events: SttEvents,
  createWebSocket?: SttWebSocketFactory,
): Promise<{ ws: WebSocket; handle: SttHandle }> {
  const params = new URLSearchParams({
    sample_rate: String(config.sampleRate),
    speech_model: config.speechModel,
    format_turns: String(config.formatTurns),
    min_end_of_turn_silence_when_confident: String(
      config.minEndOfTurnSilenceWhenConfident,
    ),
    max_turn_silence: String(config.maxTurnSilence),
  });
  if (config.prompt) {
    params.set("prompt", config.prompt);
  }

  const url = `${config.wssBase}?${params}`;
  const wsOpts = { headers: { Authorization: apiKey } };
  // Deno 2.5+ supports custom headers on client WebSocket connections
  let ws: WebSocket;
  if (createWebSocket) {
    ws = createWebSocket(url, wsOpts);
  } else {
    ws = createDenoWebSocket(url, wsOpts);
  }

  try {
    return await deadline(
      new Promise<{ ws: WebSocket; handle: SttHandle }>((resolve, reject) => {
        ws.onopen = () => {
          const handle: SttHandle = {
            send(audio: Uint8Array) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(audio);
              }
            },
            clear() {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ForceEndpoint" }));
              }
            },
            close() {
              ws.close();
            },
          };
          resolve({ ws, handle });
        };

        let msgCount = 0;
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch (err) {
            log.warn({ err }, "Failed to parse message");
            return;
          }

          const result = SttMessageSchema.safeParse(parsed);
          if (!result.success) {
            log.warn(
              { error: result.error.message },
              "Invalid STT message, skipping",
            );
            return;
          }

          const msg = result.data;
          msgCount++;
          if (msgCount <= 5) {
            log.debug({ msgCount, type: msg.type }, "STT message");
          }
          if (msg.type === "Transcript") {
            events.onTranscript(msg.transcript ?? "", msg.is_final ?? false);
          } else if (msg.type === "Turn") {
            const text = (msg.transcript ?? "").trim();
            if (!text) return;
            if (!msg.turn_is_formatted) {
              events.onTranscript(text, false);
              return;
            }
            events.onTurn(text);
          }
        };

        ws.onerror = (event) => {
          const err = event instanceof ErrorEvent
            ? new Error(event.message)
            : new Error("WebSocket error");
          events.onError(err);
          reject(err);
        };

        ws.onclose = (event) => {
          if (event.code !== 1000) {
            log.error(
              { code: event.code, reason: event.reason ?? "" },
              "WebSocket closed unexpectedly",
            );
          }
          events.onClose();
        };
      }),
      TIMEOUTS.STT_CONNECTION,
    );
  } catch (err) {
    ws.close();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(ERR_INTERNAL.sttConnectionTimeout());
    }
    throw err;
  }
}

/** Options for connectStt. */
export interface ConnectSttOptions {
  createWebSocket?: SttWebSocketFactory;
}

/**
 * Connect to AssemblyAI STT with the API key directly via Authorization header.
 */
export function connectStt(
  apiKey: string,
  config: STTConfig,
  events: SttEvents,
  options?: ConnectSttOptions,
): Promise<SttHandle> {
  return connectSttWs(apiKey, config, events, options?.createWebSocket).then((
    { handle },
  ) => handle);
}
