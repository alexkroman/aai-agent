// core.ts — Shared: WS protocol, tool serialization, audio capture + playback.
// This is bundled into client.js and react.js served by the platform.

import {
  CLIENT_MSG,
  parseServerMessage,
  type ServerMessage,
} from "./protocol.js";

// Worklet source is inlined as text by esbuild (text loader for .worklet.js)
// @ts-expect-error — esbuild text import
import pcm16CaptureWorklet from "./worklets/pcm16-capture.worklet.js";
// @ts-expect-error — esbuild text import
import pcm16PlaybackWorklet from "./worklets/pcm16-playback.worklet.js";

export { CLIENT_MSG, parseServerMessage };
export type { ServerMessage };

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** Valid state transitions. Each key maps to the set of states it can transition to. */
const VALID_TRANSITIONS: Record<AgentState, Set<AgentState>> = {
  connecting: new Set(["ready", "error"]),
  ready: new Set(["listening", "error", "connecting"]),
  listening: new Set(["thinking", "speaking", "error", "connecting"]),
  thinking: new Set(["speaking", "listening", "error", "connecting"]),
  speaking: new Set(["listening", "thinking", "error", "connecting"]),
  error: new Set(["connecting", "ready"]),
};

export interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
}

export interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  handler: (...args: any[]) => Promise<unknown>;
}

export interface AgentOptions {
  apiKey: string;
  platformUrl?: string;
  config?: { instructions?: string; greeting?: string; voice?: string };
  tools?: Record<string, ToolDef>;
}

// ── Tool serialization ──────────────────────────────────────────

export function serializeTools(
  tools: Record<string, ToolDef>
): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: string;
}[] {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    parameters: t.parameters,
    handler: t.handler.toString(),
  }));
}

// ── Audio capture (PCM16 via AudioWorklet) ──────────────────────

export async function startMicCapture(
  ws: WebSocket,
  sampleRate: number
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new AudioContext({ sampleRate });
  await ctx.resume();
  console.log("[mic] AudioContext state:", ctx.state, "sampleRate:", ctx.sampleRate);
  const source = ctx.createMediaStreamSource(stream);

  // Buffer ~100ms of audio (1600 samples at 16kHz) before sending.
  // AssemblyAI requires frames between 50-1000ms; AudioWorklet's
  // process() fires every 128 samples (8ms) which is too small.
  const minSamples = Math.floor(sampleRate * 0.1);
  const blob = new Blob([pcm16CaptureWorklet], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  let frameCount = 0;
  const worklet = new AudioWorkletNode(ctx, "pcm16", {
    processorOptions: { minSamples },
  });
  worklet.port.onmessage = (e) => {
    frameCount++;
    if (frameCount <= 3) {
      console.log("[mic] Frame", frameCount, "bytes:", e.data.byteLength, "wsReady:", ws.readyState);
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(e.data);
    }
  };
  source.connect(worklet);
  worklet.connect(ctx.destination);

  return () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}

// ── Audio playback (PCM16 via AudioWorklet) ─────────────────────

export interface AudioPlayer {
  enqueue(pcm16Buffer: ArrayBuffer): void;
  flush(): void;
  close(): void;
}

export async function createAudioPlayer(
  sampleRate: number
): Promise<AudioPlayer> {
  const ctx = new AudioContext({ sampleRate });
  await ctx.resume(); // Ensure AudioContext is not suspended (autoplay policy)

  const blob = new Blob([pcm16PlaybackWorklet], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  const worklet = new AudioWorkletNode(ctx, "pcm16-playback");
  worklet.connect(ctx.destination);

  return {
    enqueue(pcm16Buffer: ArrayBuffer) {
      if (ctx.state === "closed") return;
      const int16 = new Int16Array(pcm16Buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }
      worklet.port.postMessage(float32, [float32.buffer]);
    },
    flush() {
      worklet.port.postMessage("flush");
    },
    close() {
      ctx.close().catch(() => {});
    },
  };
}

// ── WebSocket session management ────────────────────────────────

export interface SessionCallbacks {
  onStateChange: (state: AgentState) => void;
  onMessage: (msg: Message) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL_MS = 30_000;

export class VoiceSession {
  private ws: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private micCleanup: (() => void) | null = null;
  private callbacks: SessionCallbacks;
  private options: AgentOptions;
  private currentState: AgentState = "connecting";

  // Reconnection state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  // Heartbeat state
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongReceived = true;

  constructor(options: AgentOptions, callbacks: SessionCallbacks) {
    this.options = options;
    this.callbacks = callbacks;
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
    this.callbacks.onStateChange(newState);
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
      const voice = config.voice ?? "jess";

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
      if (event.data instanceof ArrayBuffer) {
        this.player?.enqueue(event.data);
        return;
      }

      const msg = parseServerMessage(event.data as string);
      if (!msg) return;

      switch (msg.type) {
        case CLIENT_MSG.READY: {
          this.reconnectAttempts = 0;
          Promise.all([
            createAudioPlayer(msg.ttsSampleRate ?? 24000),
            startMicCapture(ws, msg.sampleRate ?? 16000),
          ]).then(([player, micCleanup]) => {
            this.player = player;
            this.micCleanup = micCleanup;
            this.changeState("listening");
          }).catch((err) => {
            console.error("Audio setup failed:", err);
            this.callbacks.onError(`Microphone access failed: ${err.message}`);
            this.changeState("error");
          });
          break;
        }
        case CLIENT_MSG.GREETING:
          this.callbacks.onMessage({ role: "assistant", text: msg.text });
          this.changeState("speaking");
          break;
        case CLIENT_MSG.TRANSCRIPT:
          this.callbacks.onTranscript(msg.text);
          break;
        case CLIENT_MSG.TURN:
          this.callbacks.onMessage({ role: "user", text: msg.text });
          this.callbacks.onTranscript("");
          break;
        case CLIENT_MSG.THINKING:
          this.changeState("thinking");
          break;
        case CLIENT_MSG.CHAT:
          this.callbacks.onMessage({
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
          this.callbacks.onError(msg.message);
          this.changeState("error");
          break;
      }
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
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.callbacks.onError("Connection lost. Please refresh.");
      this.changeState("error");
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 16000);
    this.reconnectAttempts++;
    this.changeState("connecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
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
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupAudio();
    this.ws?.close();
    this.ws = null;
  }
}
