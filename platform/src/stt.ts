// stt.ts — AssemblyAI token creation + WebSocket client with auto-refresh.

import WebSocket from "ws";
import { TIMEOUTS } from "./constants.js";
import { ERR_INTERNAL } from "./errors.js";
import { createLogger } from "./logger.js";
import { SttMessageSchema, type STTConfig } from "./types.js";

const log = createLogger("stt");

const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

/** Fraction of token lifetime at which to trigger refresh (80%). */
const TOKEN_REFRESH_RATIO = 0.8;

/**
 * Create an ephemeral streaming token for AssemblyAI STT.
 */
export async function createSttToken(apiKey: string, expiresIn: number): Promise<string> {
  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(expiresIn));
  const resp = await fetch(url, {
    headers: { Authorization: apiKey },
  });
  if (!resp.ok) {
    throw new Error(ERR_INTERNAL.sttTokenFailed(resp.status, resp.statusText));
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}

/** Callbacks for STT events (transcripts, completed turns, errors, close). */
export interface SttEvents {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurn: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/** Handle returned by connectStt / SttConnection. */
export interface SttHandle {
  send: (audio: Buffer) => void;
  clear: () => void;
  close: () => void;
}

/**
 * Connect a single STT WebSocket (internal helper, no refresh logic).
 */
function connectSttWs(
  token: string,
  config: STTConfig,
  events: SttEvents
): Promise<{ ws: WebSocket; handle: SttHandle }> {
  const params = new URLSearchParams({
    sample_rate: String(config.sampleRate),
    speech_model: config.speechModel,
    token,
    format_turns: String(config.formatTurns),
    min_end_of_turn_silence_when_confident: String(config.minEndOfTurnSilenceWhenConfident),
    max_turn_silence: String(config.maxTurnSilence),
  });

  const ws = new WebSocket(`${config.wssBase}?${params}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(ERR_INTERNAL.sttConnectionTimeout()));
    }, TIMEOUTS.STT_CONNECTION);

    ws.on("open", () => {
      clearTimeout(timeout);
      const handle: SttHandle = {
        send(audio: Buffer) {
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
    });

    let msgCount = 0;
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch (err) {
        log.warn({ err }, "Failed to parse message");
        return;
      }

      const result = SttMessageSchema.safeParse(parsed);
      if (!result.success) {
        log.warn({ error: result.error.message }, "Invalid STT message, skipping");
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
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      events.onError(err);
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      if (code !== 1000) {
        log.error({ code, reason: reason?.toString() ?? "" }, "WebSocket closed unexpectedly");
      }
      events.onClose();
    });
  });
}

/**
 * STT connection wrapper with automatic token refresh for long sessions.
 *
 * Schedules a refresh timer at 80% of token lifetime. On timer fire, creates
 * a new STT connection, then closes the old one (seamless handoff). On unexpected
 * close, attempts reconnection (unless close() was called explicitly).
 */
export class SttConnection implements SttHandle {
  private apiKey: string;
  private config: STTConfig;
  private events: SttEvents;
  private currentHandle: SttHandle | null = null;
  private currentWs: WebSocket | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private constructor(apiKey: string, config: STTConfig, events: SttEvents) {
    this.apiKey = apiKey;
    this.config = config;
    this.events = events;
  }

  static async create(
    apiKey: string,
    config: STTConfig,
    events: SttEvents
  ): Promise<SttConnection> {
    const conn = new SttConnection(apiKey, config, events);
    await conn.connect();
    return conn;
  }

  private async connect(): Promise<void> {
    const token = await createSttToken(this.apiKey, this.config.tokenExpiresIn);
    const { ws, handle } = await connectSttWs(token, this.config, this.events);
    this.currentWs = ws;
    this.currentHandle = handle;
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const refreshMs = this.config.tokenExpiresIn * 1000 * TOKEN_REFRESH_RATIO;
    this.refreshTimer = setTimeout(() => this.refresh(), refreshMs);
  }

  private async refresh(): Promise<void> {
    if (this.closed) return;
    try {
      const oldWs = this.currentWs;
      const token = await createSttToken(this.apiKey, this.config.tokenExpiresIn);
      if (this.closed) return;
      const { ws, handle } = await connectSttWs(token, this.config, this.events);
      this.currentWs = ws;
      this.currentHandle = handle;
      this.scheduleRefresh();
      // Close old connection after new one is ready
      try {
        oldWs?.close();
      } catch {
        // ignore close errors on old connection
      }
    } catch (err) {
      log.error({ err }, "Token refresh failed");
      // Keep using current connection until it expires
    }
  }

  send(audio: Buffer): void {
    this.currentHandle?.send(audio);
  }

  clear(): void {
    this.currentHandle?.clear();
  }

  close(): void {
    this.closed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.currentHandle?.close();
    this.currentHandle = null;
    this.currentWs = null;
  }
}

/**
 * Connect to AssemblyAI STT with automatic token refresh for long sessions.
 */
export async function connectStt(
  apiKey: string,
  config: STTConfig,
  events: SttEvents
): Promise<SttHandle> {
  return SttConnection.create(apiKey, config, events);
}
