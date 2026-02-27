// session.ts — VoiceSession: WebSocket session management for voice agents.

import {
  CLIENT_MSG,
  parseServerMessage,
} from "./protocol.js";

import {
  type AgentState,
  type AgentOptions,
  type Message,
  VALID_TRANSITIONS,
  DEFAULT_VOICE,
  PING_INTERVAL_MS,
  serializeTools,
} from "./types.js";

import { TypedEmitter, type SessionEventMap } from "./emitter.js";
import { SessionError, SessionErrorCode } from "./errors.js";
import { ReconnectStrategy } from "./reconnect.js";
import { startMicCapture, createAudioPlayer, type AudioPlayer } from "./audio.js";

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
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production" &&
      !VALID_TRANSITIONS[this.currentState].has(newState)
    ) {
      console.warn(
        `[VoiceSession] Invalid state transition: ${this.currentState} -> ${newState}`
      );
    }
    this.currentState = newState;
    this.emit("stateChange", newState);
  }

  connect(): void {
    this.intentionalDisconnect = false;
    const platformUrl =
      this.options.platformUrl ?? "wss://platform.example.com";
    const ws = new WebSocket(`${platformUrl}/session`);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      // Send authenticate message first
      ws.send(
        JSON.stringify({
          type: CLIENT_MSG.AUTHENTICATE,
          apiKey: this.options.apiKey,
        })
      );

      // Build config from options
      const config = this.options.config ?? {};
      const instructions = config.instructions ?? "";
      const greeting = config.greeting ?? "";
      const voice = config.voice ?? DEFAULT_VOICE;

      // Serialize tools and send configure message
      const tools = this.options.tools
        ? serializeTools(this.options.tools)
        : [];

      ws.send(
        JSON.stringify({
          type: CLIENT_MSG.CONFIGURE,
          instructions,
          greeting,
          voice,
          tools,
        })
      );
      this.changeState("ready");

      // Start heartbeat
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
      this.cleanupAudio();
      this.scheduleReconnect();
    };
  }

  private handleServerMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      this.player?.enqueue(event.data);
      return;
    }

    const msg = parseServerMessage(event.data as string);
    if (!msg) return;

    switch (msg.type) {
      case CLIENT_MSG.READY: {
        this.reconnector.reset();
        Promise.all([
          createAudioPlayer(msg.ttsSampleRate ?? 24000),
          startMicCapture(this.ws!, msg.sampleRate ?? 16000),
        ]).then(([player, micCleanup]) => {
          this.player = player;
          this.micCleanup = micCleanup;
          this.changeState("listening");
        }).catch((err) => {
          console.error("Audio setup failed:", err);
          this.emit(
            "error",
            new SessionError(
              SessionErrorCode.AUDIO_SETUP_FAILED,
              `Microphone access failed: ${err.message}`
            )
          );
          this.changeState("error");
        });
        break;
      }
      case CLIENT_MSG.GREETING:
        this.emit("message", { role: "assistant", text: msg.text });
        this.changeState("speaking");
        break;
      case CLIENT_MSG.TRANSCRIPT:
        this.emit("transcript", msg.text);
        break;
      case CLIENT_MSG.TURN:
        this.emit("message", { role: "user", text: msg.text });
        this.emit("transcript", "");
        break;
      case CLIENT_MSG.THINKING:
        this.changeState("thinking");
        break;
      case CLIENT_MSG.CHAT:
        this.emit("message", {
          role: "assistant",
          text: msg.text,
          steps: msg.steps,
        });
        this.changeState("speaking");
        break;
      case CLIENT_MSG.TTS_DONE:
        this.changeState("listening");
        break;
      case CLIENT_MSG.CANCELLED:
        this.player?.flush();
        this.changeState("listening");
        break;
      case CLIENT_MSG.PONG:
        this.pongReceived = true;
        break;
      case CLIENT_MSG.ERROR:
        console.error("Agent error:", msg.message);
        this.emit(
          "error",
          new SessionError(SessionErrorCode.SERVER_ERROR, msg.message)
        );
        this.changeState("error");
        break;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pongReceived = true;
    this.pingInterval = setInterval(() => {
      if (!this.pongReceived) {
        // No pong received since last ping — connection is dead
        this.ws?.close();
        return;
      }
      this.pongReceived = false;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: CLIENT_MSG.PING }));
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
          "Connection lost. Please refresh."
        )
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: CLIENT_MSG.CANCEL }));
    }
    this.player?.flush();
  }

  reset(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "reset" }));
    }
    this.player?.flush();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.stopPing();
    this.reconnector.cancel();
    this.cleanupAudio();
    this.ws?.close();
    this.ws = null;
  }
}
