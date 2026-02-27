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
  toWebSocketUrl,
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

  // Cancel/reset synchronization
  private cancelling = false;
  private connectionId = 0;

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
    this.cancelling = false;
    this.connectionId++;
    const platformUrl = toWebSocketUrl(
      this.options.platformUrl ?? "wss://platform.example.com"
    );
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

      // Read flat config fields from options
      const instructions = this.options.instructions ?? "";
      const greeting = this.options.greeting ?? "";
      const voice = this.options.voice ?? DEFAULT_VOICE;
      const prompt = this.options.prompt;

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
          ...(prompt ? { prompt } : {}),
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
      if (!this.cancelling) {
        this.player?.enqueue(event.data);
      }
      return;
    }

    const msg = parseServerMessage(event.data as string);
    if (!msg) return;

    switch (msg.type) {
      case CLIENT_MSG.READY: {
        this.reconnector.reset();
        const connId = this.connectionId;
        Promise.all([
          createAudioPlayer(msg.ttsSampleRate ?? 24000),
          startMicCapture(this.ws!, msg.sampleRate ?? 16000),
        ]).then(([player, micCleanup]) => {
          if (connId !== this.connectionId) {
            // Connection changed while audio was setting up — discard
            player.close();
            micCleanup();
            return;
          }
          this.player = player;
          this.micCleanup = micCleanup;
          this.changeState("listening");
        }).catch((err) => {
          if (connId !== this.connectionId) return;
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
        this.cancelling = false;
        this.player?.flush();
        this.changeState("listening");
        break;
      case CLIENT_MSG.RESET:
        this.cancelling = false;
        this.player?.flush();
        this.emit("reset");
        break;
      case CLIENT_MSG.PONG:
        this.pongReceived = true;
        break;
      case CLIENT_MSG.ERROR: {
        const details = (msg as import("./protocol.js").ErrorMessage).details;
        const fullMessage = details?.length
          ? `${msg.message}: ${details.join(", ")}`
          : msg.message;
        console.error("Agent error:", fullMessage);
        this.emit(
          "error",
          new SessionError(SessionErrorCode.SERVER_ERROR, fullMessage)
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
    this.cancelling = true;
    this.player?.flush();
    this.changeState("listening");
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: CLIENT_MSG.CANCEL }));
    }
  }

  reset(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: CLIENT_MSG.RESET }));
    }
    this.player?.flush();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cancelling = false;
    this.connectionId++;
    this.stopPing();
    this.reconnector.cancel();
    this.cleanupAudio();
    this.ws?.close();
    this.ws = null;
  }
}
