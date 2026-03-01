import type { ErrorMessage, ServerMessage } from "../_protocol.ts";

import {
  type AgentOptions,
  type AgentState,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RECONNECT_ATTEMPTS,
  type Message,
  PING_INTERVAL_MS,
} from "./types.ts";

import type { AudioPlayer, MicCapture } from "./audio.ts";

const DEFAULT_STT_SAMPLE_RATE = 16_000;
const DEFAULT_TTS_SAMPLE_RATE = 24_000;

export type SessionErrorCode =
  | "AUDIO_SETUP_FAILED"
  | "SERVER_ERROR"
  | "MAX_RECONNECTS";

export type SessionError = Error & { code: SessionErrorCode };

function sessionError(code: SessionErrorCode, message: string): SessionError {
  return Object.assign(new Error(message), { code, name: "SessionError" });
}

export interface Reconnect {
  readonly canRetry: boolean;
  schedule(cb: () => void): boolean;
  cancel(): void;
  reset(): void;
}

export function createReconnect(
  maxAttempts = MAX_RECONNECT_ATTEMPTS,
  maxBackoff = MAX_BACKOFF_MS,
  initialBackoff = INITIAL_BACKOFF_MS,
): Reconnect {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    get canRetry() {
      return attempts < maxAttempts;
    },
    schedule(cb) {
      if (attempts >= maxAttempts) return false;
      const delay = Math.min(initialBackoff * 2 ** attempts, maxBackoff);
      attempts++;
      timer = setTimeout(() => {
        timer = null;
        cb();
      }, delay);
      return true;
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    reset() {
      attempts = 0;
    },
  };
}

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

// deno-lint-ignore no-explicit-any
type Fn = (...args: any[]) => void;

class TypedEmitter<E> {
  private listeners = new Map<keyof E, Set<Fn>>();

  on<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Fn);
    return () => {
      set!.delete(handler as Fn);
    };
  }

  protected emit<K extends keyof E>(
    event: K,
    ...args: E[K] extends void ? [] : [E[K]]
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Fn)(...args);
    }
  }
}

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data);
    if (
      typeof msg !== "object" || msg === null || typeof msg.type !== "string"
    ) return null;
    return msg as ServerMessage;
  } catch {
    return null;
  }
}

export class VoiceSession extends TypedEmitter<SessionEventMap> {
  private ws: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private mic: MicCapture | null = null;
  private currentState: AgentState = "connecting";
  private reconnector = createReconnect();
  private connectionController: AbortController | null = null;
  private cancelling = false;
  private audioSetupInFlight = false;
  private pongReceived = true;

  constructor(private options: AgentOptions) {
    super();
  }

  private changeState(newState: AgentState): void {
    if (newState === this.currentState) return;
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
      case "ready":
        this.reconnector.reset();
        void this.handleReady(msg);
        break;
      case "greeting":
        this.emit("message", { role: "assistant", text: msg.text });
        this.changeState("speaking");
        break;
      case "transcript":
        if (
          (this.currentState === "speaking" ||
            this.currentState === "thinking") &&
          msg.text.trim()
        ) {
          this.cancel();
        }
        this.emit("transcript", msg.text);
        break;
      case "turn":
        this.emit("message", { role: "user", text: msg.text });
        this.emit("transcript", "");
        break;
      case "thinking":
        this.changeState("thinking");
        break;
      case "chat":
        this.emit("message", {
          role: "assistant",
          text: msg.text,
          steps: msg.steps,
        });
        this.changeState("speaking");
        break;
      case "tts_done":
        this.changeState("listening");
        break;
      case "cancelled":
        this.player?.flush();
        this.cancelling = false;
        this.changeState("listening");
        break;
      case "reset":
        this.cancelling = false;
        this.player?.flush();
        this.emit("reset");
        break;
      case "pong":
        this.pongReceived = true;
        break;
      case "error": {
        const details = (msg as ErrorMessage).details;
        const fullMessage = details?.length
          ? `${msg.message}: ${details.join(", ")}`
          : msg.message;
        console.error("Agent error:", fullMessage);
        this.emit("error", sessionError("SERVER_ERROR", fullMessage));
        this.changeState("error");
        break;
      }
    }
  }

  private async handleReady(
    msg: Extract<ServerMessage, { type: "ready" }>,
  ): Promise<void> {
    if (this.audioSetupInFlight) return;
    this.audioSetupInFlight = true;
    try {
      const { createAudioPlayer, startMicCapture } = await import(
        "./audio.ts"
      );
      const [player, mic] = await Promise.all([
        createAudioPlayer(msg.ttsSampleRate ?? DEFAULT_TTS_SAMPLE_RATE),
        startMicCapture(
          this.ws!,
          msg.sampleRate ?? DEFAULT_STT_SAMPLE_RATE,
        ),
      ]);
      if (this.ws?.readyState !== WebSocket.OPEN) {
        player.close();
        mic.close();
        return;
      }
      this.player = player;
      this.mic = mic;
      this.ws.send(JSON.stringify({ type: "audio_ready" }));
      this.emit("audioReady");
      this.changeState("listening");
      this.emit("connected");
    } catch (err) {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.emit(
        "error",
        sessionError(
          "AUDIO_SETUP_FAILED",
          `Microphone access failed: ${(err as Error).message}`,
        ),
      );
      this.changeState("error");
    } finally {
      this.audioSetupInFlight = false;
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
        this.ws.send(JSON.stringify({ type: "ping" }));
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
        sessionError("MAX_RECONNECTS", "Connection lost. Please refresh."),
      );
      this.changeState("error");
      return;
    }
    this.changeState("connecting");
  }

  private cleanupAudio(): void {
    this.audioSetupInFlight = false;
    this.mic?.close();
    this.mic = null;
    this.player?.close();
    this.player = null;
  }

  private trySend(msg: Record<string, unknown>): boolean {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
        return true;
      }
    } catch { /* ws may have closed between check and send */ }
    return false;
  }

  cancel(): void {
    if (this.cancelling) return;
    this.cancelling = true;
    this.player?.flush();
    this.changeState("listening");
    this.trySend({ type: "cancel" });
  }

  reset(): void {
    this.player?.flush();
    if (this.trySend({ type: "reset" })) return;
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
