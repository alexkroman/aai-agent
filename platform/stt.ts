import { deadline } from "@std/async/deadline";
import { ERR_INTERNAL } from "./errors.ts";

const STT_CONNECTION_TIMEOUT = 10_000;
import { getLogger } from "../sdk/logger.ts";
import { type STTConfig, SttMessageSchema } from "./types.ts";

const log = getLogger("stt");

export type SttWebSocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket;

export interface SttEvents {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurn: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export interface SttHandle {
  send: (audio: Uint8Array) => void;
  clear: () => void;
  close: () => void;
}

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

  const ws = createWebSocket?.(url, wsOpts) ??
    // deno-lint-ignore no-explicit-any
    new (WebSocket as any)(url, wsOpts);

  try {
    return await deadline(
      new Promise<{ ws: WebSocket; handle: SttHandle }>((resolve, reject) => {
        ws.onopen = () => {
          const handle: SttHandle = {
            send(audio: Uint8Array) {
              if (ws.readyState === WebSocket.OPEN) ws.send(audio);
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
        ws.onmessage = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch (err) {
            log.warn("Failed to parse message", { err });
            return;
          }

          const result = SttMessageSchema.safeParse(parsed);
          if (!result.success) {
            log.warn("Invalid STT message, skipping", {
              error: result.error.message,
            });
            return;
          }

          const msg = result.data;
          msgCount++;
          if (msgCount <= 5) {
            log.debug("STT message", { msgCount, type: msg.type });
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

        ws.onerror = (event: Event) => {
          const err = event instanceof ErrorEvent
            ? new Error(event.message)
            : new Error("WebSocket error");
          events.onError(err);
          reject(err);
        };

        ws.onclose = (event: CloseEvent) => {
          if (event.code !== 1000) {
            log.error("WebSocket closed unexpectedly", {
              code: event.code,
              reason: event.reason ?? "",
            });
            events.onError(
              new Error(
                `STT WebSocket closed unexpectedly (code ${event.code})`,
              ),
            );
          }
          events.onClose();
        };
      }),
      STT_CONNECTION_TIMEOUT,
    );
  } catch (err) {
    ws.close();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(ERR_INTERNAL.sttConnectionTimeout());
    }
    throw err;
  }
}

export interface ConnectSttOptions {
  createWebSocket?: SttWebSocketFactory;
}

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
