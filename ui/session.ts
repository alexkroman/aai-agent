// session.ts — VoiceSession: WebSocket session management for voice agents.
// Simplified: no auth/configure — agent is configured server-side.

import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  type ErrorMessage,
  MSG,
  type ServerMessage,
} from "../sdk/shared-protocol.ts";

import {
  type AgentOptions,
  type AgentState,
  type Message,
  PING_INTERVAL_MS,
  VALID_TRANSITIONS,
} from "./types.ts";

import { SessionError, SessionErrorCode } from "./errors.ts";
import { ReconnectStrategy } from "./reconnect.ts";
import type { AudioPlayer } from "./audio.ts";

// ── Typed event helpers ─────────────────────────────────────────

export interface SessionEventMap {
  stateChange: AgentState;
  message: Message;
  transcript: string;
  error: SessionError;
  connected: void;
  disconnected: { intentional: boolean };
  audioReady: void;
  reset: void;
}

// ── Protocol parser ──────────────────────────────────────────────

const KNOWN_SERVER_TYPES = new Set<string>(Object.values(MSG));

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data);
    if (
      typeof msg !== "object" || msg === null || typeof msg.type !== "string"
    ) return null;
    if (!KNOWN_SERVER_TYPES.has(msg.type)) return null;
    return msg as ServerMessage;
  } catch {
    return null;
  }
}

// ── VoiceSession ───────────────────────────────────────────────

export class VoiceSession extends EventTarget {
  private ws: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private micCleanup: (() => void) | null = null;
  private options: AgentOptions;
  private currentState: AgentState = "connecting";

  // Reconnection
  private reconnector = new ReconnectStrategy();

  // Connection lifecycle — abort to tear down ws listeners + ping
  private connectionController: AbortController | null = null;

  // Cancel/reset synchronization
  private cancelling = false;

  // Guard against duplicate audio setup (e.g. two READY messages)
  private audioSetupInFlight = false;

  // Heartbeat
  private pongReceived = true;

  constructor(options: AgentOptions) {
    super();
    this.options = options;
  }

  // ── Typed event helpers ───────────────────────────────────────

  on<K extends keyof SessionEventMap>(
    event: K,
    handler: SessionEventMap[K] extends void ? () => void
      : (data: SessionEventMap[K]) => void,
  ): () => void {
    const wrapper = ((e: Event) => {
      (handler as (data?: SessionEventMap[K]) => void)(
        (e as CustomEvent).detail,
      );
    }) as EventListener;
    this.addEventListener(event, wrapper);
    return () => this.removeEventListener(event, wrapper);
  }

  protected emit<K extends keyof SessionEventMap>(
    event: K,
    ...args: SessionEventMap[K] extends void ? [] : [SessionEventMap[K]]
  ): void {
    this.dispatchEvent(new CustomEvent(event, { detail: args[0] }));
  }

  private changeState(newState: AgentState): void {
    if (newState === this.currentState) return;
    const g = globalThis as Record<string, unknown>;
    if (
      typeof g.process !== "undefined" &&
      (g.process as Record<string, unknown>).env &&
      (g.process as Record<string, Record<string, string>>).env
          ?.NODE_ENV !== "production" &&
      !VALID_TRANSITIONS[this.currentState].has(newState)
    ) {
      console.warn(
        `[VoiceSession] Invalid state transition: ${this.currentState} -> ${newState}`,
      );
    }
    this.currentState = newState;
    this.emit("stateChange", newState);
  }

  connect(): void {
    this.connectionController?.abort();
    const controller = new AbortController();
    this.connectionController = controller;
    const { signal } = controller;

    this.cancelling = false;
    const base = this.options.platformUrl || globalThis.location.origin;
    const wsUrl = new URL("session", base.endsWith("/") ? base : base + "/");
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      this.changeState("ready");
      this.startPing(signal);
    }, { signal });

    ws.addEventListener("message", (event) => {
      this.handleServerMessage(event);
    }, { signal });

    ws.addEventListener("close", () => {
      if (signal.aborted) {
        this.changeState("connecting");
        return;
      }
      controller.abort();
      this.emit("disconnected", { intentional: false });
      this.cleanupAudio();
      this.scheduleReconnect();
    }, { signal });
  }

  private handleServerMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      if (!this.cancelling) {
        this.player?.enqueue(event.data);
      }
      return;
    }

    const msg = parseServerMessage(event.data as string);
    if (!msg) return;

    switch (msg.type) {
      case MSG.READY: {
        this.reconnector.reset();
        if (this.audioSetupInFlight) break;
        this.audioSetupInFlight = true;
        import("./audio.ts").then(({ createAudioPlayer, startMicCapture }) =>
          Promise.all([
            createAudioPlayer(msg.ttsSampleRate ?? DEFAULT_TTS_SAMPLE_RATE),
            startMicCapture(this.ws!, msg.sampleRate ?? DEFAULT_STT_SAMPLE_RATE),
          ])
        )
          .then(([player, micCleanup]) => {
            this.audioSetupInFlight = false;
            if (this.ws?.readyState !== WebSocket.OPEN) {
              player.close();
              micCleanup();
              return;
            }
            this.player = player;
            this.micCleanup = micCleanup;
            this.ws.send(JSON.stringify({ type: MSG.AUDIO_READY }));
            this.emit("audioReady");
            this.changeState("listening");
            this.emit("connected");
          })
          .catch((err) => {
            this.audioSetupInFlight = false;
            if (this.ws?.readyState !== WebSocket.OPEN) return;
            console.error("Audio setup failed:", err);
            this.emit(
              "error",
              new SessionError(
                SessionErrorCode.AUDIO_SETUP_FAILED,
                `Microphone access failed: ${err.message}`,
              ),
            );
            this.changeState("error");
          });
        break;
      }
      case MSG.GREETING:
        this.emit("message", { role: "assistant", text: msg.text });
        this.changeState("speaking");
        break;
      case MSG.TRANSCRIPT:
        this.emit("transcript", msg.text);
        break;
      case MSG.TURN:
        this.emit("message", { role: "user", text: msg.text });
        this.emit("transcript", "");
        break;
      case MSG.THINKING:
        this.changeState("thinking");
        break;
      case MSG.CHAT:
        this.emit("message", {
          role: "assistant",
          text: msg.text,
          steps: msg.steps,
        });
        this.changeState("speaking");
        break;
      case MSG.TTS_DONE:
        this.changeState("listening");
        break;
      case MSG.CANCELLED:
        this.cancelling = false;
        this.player?.flush();
        this.changeState("listening");
        break;
      case MSG.RESET:
        this.cancelling = false;
        this.player?.flush();
        this.emit("reset");
        break;
      case MSG.PONG:
        this.pongReceived = true;
        break;
      case MSG.ERROR: {
        const details = (msg as ErrorMessage).details;
        const fullMessage = details?.length
          ? `${msg.message}: ${details.join(", ")}`
          : msg.message;
        console.error("Agent error:", fullMessage);
        this.emit(
          "error",
          new SessionError(SessionErrorCode.SERVER_ERROR, fullMessage),
        );
        this.changeState("error");
        break;
      }
    }
  }

  private startPing(signal: AbortSignal): void {
    this.pongReceived = true;
    const id = setInterval(() => {
      if (!this.pongReceived) {
        this.ws?.close();
        return;
      }
      this.pongReceived = false;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: MSG.PING }));
      }
    }, PING_INTERVAL_MS);
    signal.addEventListener("abort", () => clearInterval(id));
  }

  private scheduleReconnect(): void {
    const scheduled = this.reconnector.schedule(() => {
      this.connect();
    });
    if (!scheduled) {
      this.emit(
        "error",
        new SessionError(
          SessionErrorCode.MAX_RECONNECTS,
          "Connection lost. Please refresh.",
        ),
      );
      this.changeState("error");
      return;
    }
    this.changeState("connecting");
  }

  private cleanupAudio(): void {
    this.audioSetupInFlight = false;
    this.micCleanup?.();
    this.micCleanup = null;
    this.player?.close();
    this.player = null;
  }

  cancel(): void {
    this.cancelling = true;
    this.player?.flush();
    this.changeState("listening");
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: MSG.CANCEL }));
      }
    } catch {
      // Connection may have broken between readyState check and send
    }
  }

  reset(): void {
    this.player?.flush();
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: MSG.RESET }));
        return;
      }
    } catch {
      // Connection may have broken between readyState check and send
    }
    this.emit("reset");
    this.disconnect();
    this.connect();
  }

  disconnect(): void {
    this.connectionController?.abort();
    this.connectionController = null;
    this.cancelling = false;
    this.reconnector.cancel();
    this.cleanupAudio();
    this.ws?.close();
    this.ws = null;
    this.emit("disconnected", { intentional: true });
  }
}
