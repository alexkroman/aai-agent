// session.ts — VoiceSession: WebSocket session management for voice agents.
// Simplified: no auth/configure — agent is configured server-side.

import { MSG, type ErrorMessage, type ServerMessage } from "../server/shared-protocol.js";

import {
  type AgentState,
  type AgentOptions,
  type Message,
  VALID_TRANSITIONS,
  PING_INTERVAL_MS,
  toWebSocketUrl,
} from "./types.js";

import { TypedEmitter, type SessionEventMap } from "./emitter.js";
import { SessionError, SessionErrorCode } from "./errors.js";
import { ReconnectStrategy } from "./reconnect.js";
import { startMicCapture, createAudioPlayer, type AudioPlayer } from "./audio.js";

// ── Protocol parser ──────────────────────────────────────────────

const KNOWN_SERVER_TYPES = new Set<string>(Object.values(MSG));

function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data);
    if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") return null;
    if (!KNOWN_SERVER_TYPES.has(msg.type)) return null;
    return msg as ServerMessage;
  } catch {
    return null;
  }
}

// ── Callback interface (backward compat) ───────────────────────

export interface SessionCallbacks {
  onStateChange: (state: AgentState) => void;
  onMessage: (msg: Message) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

// ── VoiceSession ───────────────────────────────────────────────

export class VoiceSession extends TypedEmitter<SessionEventMap> {
  private ws: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private micCleanup: (() => void) | null = null;
  private options: AgentOptions;
  private currentState: AgentState = "connecting";

  // Reconnection
  private reconnector = new ReconnectStrategy();
  private intentionalDisconnect = false;

  // Cancel/reset synchronization
  private cancelling = false;

  // Heartbeat
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongReceived = true;

  constructor(options: AgentOptions, callbacks?: SessionCallbacks) {
    super();
    this.options = options;

    // Wire legacy callbacks as event listeners for backward compat
    if (callbacks) {
      this.on("stateChange", callbacks.onStateChange);
      this.on("message", callbacks.onMessage);
      this.on("transcript", callbacks.onTranscript);
      this.on("error", (err) => callbacks.onError(err.message));
    }
  }

  private changeState(newState: AgentState): void {
    if (newState === this.currentState) return;
    if (
      typeof globalThis.process !== "undefined" &&
      (globalThis.process as Record<string, unknown>).env &&
      ((globalThis.process as Record<string, Record<string, string>>).env)
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
    this.intentionalDisconnect = false;
    this.cancelling = false;
    const platformUrl = toWebSocketUrl(
      this.options.platformUrl || window.location.origin,
    );
    const ws = new WebSocket(`${platformUrl}/session`);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      // No auth/configure needed — session starts immediately server-side.
      this.changeState("ready");
      this.startPing();
    };

    ws.onmessage = (event) => {
      this.handleServerMessage(event);
    };

    ws.onclose = () => {
      this.stopPing();
      if (this.intentionalDisconnect) {
        this.changeState("connecting");
        return;
      }
      this.emit("disconnected", { intentional: false });
      this.cleanupAudio();
      this.scheduleReconnect();
    };
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
        Promise.all([
          createAudioPlayer(msg.ttsSampleRate ?? 24000),
          startMicCapture(this.ws!, msg.sampleRate ?? 16000),
        ])
          .then(([player, micCleanup]) => {
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

  private startPing(): void {
    this.stopPing();
    this.pongReceived = true;
    this.pingInterval = setInterval(() => {
      if (!this.pongReceived) {
        this.ws?.close();
        return;
      }
      this.pongReceived = false;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: MSG.PING }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
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
    this.micCleanup?.();
    this.micCleanup = null;
    this.player?.close();
    this.player = null;
  }

  cancel(): void {
    this.cancelling = true;
    this.player?.flush();
    this.changeState("listening");
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: MSG.CANCEL }));
    }
  }

  reset(): void {
    this.player?.flush();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: MSG.RESET }));
    } else {
      this.emit("reset");
      this.disconnect();
      this.connect();
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cancelling = false;
    this.stopPing();
    this.reconnector.cancel();
    this.cleanupAudio();
    this.ws?.close();
    this.ws = null;
    this.emit("disconnected", { intentional: true });
  }
}
