// stt.ts — AssemblyAI token creation + WebSocket client.

import WebSocket from "ws";
import { TIMEOUTS } from "./constants.js";
import { ERR_INTERNAL } from "./errors.js";
import type { STTConfig } from "./types.js";

const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

/**
 * Create an ephemeral streaming token for AssemblyAI STT.
 */
export async function createSttToken(
  apiKey: string,
  expiresIn: number,
): Promise<string> {
  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(expiresIn));
  const resp = await fetch(url, {
    headers: { Authorization: apiKey },
  });
  if (!resp.ok) {
    throw new Error(
      ERR_INTERNAL.STT_TOKEN_FAILED(resp.status, resp.statusText),
    );
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}

export interface SttEvents {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurn: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/**
 * Connect to AssemblyAI STT WebSocket and return a handle for sending audio.
 */
export async function connectStt(
  apiKey: string,
  config: STTConfig,
  events: SttEvents,
): Promise<{
  send: (audio: Buffer) => void;
  clear: () => void;
  close: () => void;
}> {
  const token = await createSttToken(apiKey, config.tokenExpiresIn);

  const params = new URLSearchParams({
    sample_rate: String(config.sampleRate),
    speech_model: config.speechModel,
    token,
    format_turns: String(config.formatTurns),
    min_end_of_turn_silence_when_confident: String(
      config.minEndOfTurnSilenceWhenConfident,
    ),
    max_turn_silence: String(config.maxTurnSilence),
  });

  const ws = new WebSocket(`${config.wssBase}?${params}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(ERR_INTERNAL.STT_CONNECTION_TIMEOUT));
    }, TIMEOUTS.STT_CONNECTION);

    ws.on("open", () => {
      clearTimeout(timeout);
      resolve({
        send(audio: Buffer) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(audio);
          }
        },
        clear() {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ operation: "clear" }));
          }
        },
        close() {
          ws.close();
        },
      });
    });

    ws.on("message", (raw) => {
      if (raw instanceof Buffer && raw.length > 0) return; // skip binary
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "Transcript") {
          events.onTranscript(msg.transcript ?? "", msg.is_final ?? false);
        } else if (msg.type === "Turn") {
          const text = (msg.transcript ?? "").trim();
          if (!text) return;
          if (!msg.turn_is_formatted) {
            // Partial turn — send as transcript
            events.onTranscript(text, false);
            return;
          }
          events.onTurn(text);
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      events.onError(err);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      events.onClose();
    });
  });
}
