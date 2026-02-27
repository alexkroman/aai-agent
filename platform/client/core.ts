// core.ts — Shared: WS protocol, tool serialization, audio capture + playback.
// This is bundled into client.js and react.js served by the platform.

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

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
  instructions?: string;
  greeting?: string;
  voice?: string;
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
  const MIN_SAMPLES = Math.floor(sampleRate * 0.1);
  const workletCode = `
    class PCM16Processor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._buf = [];
        this._len = 0;
        this._min = ${MIN_SAMPLES};
      }
      process(inputs) {
        const input = inputs[0][0];
        if (input) {
          this._buf.push(input.slice());
          this._len += input.length;
          if (this._len >= this._min) {
            const merged = new Float32Array(this._len);
            let off = 0;
            for (const chunk of this._buf) {
              merged.set(chunk, off);
              off += chunk.length;
            }
            const int16 = new Int16Array(this._len);
            for (let i = 0; i < this._len; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, merged[i] * 32768));
            }
            this.port.postMessage(int16.buffer, [int16.buffer]);
            this._buf = [];
            this._len = 0;
          }
        }
        return true;
      }
    }
    registerProcessor("pcm16", PCM16Processor);
  `;
  const blob = new Blob([workletCode], { type: "application/javascript" });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));

  let frameCount = 0;
  const worklet = new AudioWorkletNode(ctx, "pcm16");
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

  const workletCode = `
    class PCM16PlaybackProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._buf = new Float32Array(0);
        this.port.onmessage = (e) => {
          if (e.data === "flush") {
            this._buf = new Float32Array(0);
            return;
          }
          // Append new samples to buffer
          const incoming = e.data;
          const merged = new Float32Array(this._buf.length + incoming.length);
          merged.set(this._buf);
          merged.set(incoming, this._buf.length);
          this._buf = merged;
        };
      }
      process(_inputs, outputs) {
        const output = outputs[0][0];
        if (!output) return true;
        const n = Math.min(this._buf.length, output.length);
        if (n > 0) {
          output.set(this._buf.subarray(0, n));
          this._buf = this._buf.subarray(n);
        }
        // Silence for any remaining samples
        for (let i = n; i < output.length; i++) output[i] = 0;
        return true;
      }
    }
    registerProcessor("pcm16-playback", PCM16PlaybackProcessor);
  `;

  const blob = new Blob([workletCode], { type: "application/javascript" });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));

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

export class VoiceSession {
  private ws: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private micCleanup: (() => void) | null = null;
  private callbacks: SessionCallbacks;
  private options: AgentOptions;

  constructor(options: AgentOptions, callbacks: SessionCallbacks) {
    this.options = options;
    this.callbacks = callbacks;
  }

  connect(): void {
    const platformUrl =
      this.options.platformUrl ?? "wss://platform.example.com";
    const ws = new WebSocket(`${platformUrl}/session?key=${this.options.apiKey}`);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      // Build config from options
      const config = this.options.config ?? {};
      const instructions =
        config.instructions ?? this.options.instructions ?? "";
      const greeting = config.greeting ?? this.options.greeting ?? "";
      const voice = config.voice ?? this.options.voice ?? "jess";

      // Serialize tools and send configure message
      const tools = this.options.tools
        ? serializeTools(this.options.tools)
        : [];

      ws.send(
        JSON.stringify({
          type: "configure",
          instructions,
          greeting,
          voice,
          tools,
        })
      );
      this.callbacks.onStateChange("ready");
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.player?.enqueue(event.data);
        return;
      }

      const msg = JSON.parse(event.data as string);
      switch (msg.type) {
        case "ready": {
          Promise.all([
            createAudioPlayer(msg.ttsSampleRate ?? 24000),
            startMicCapture(ws, msg.sampleRate ?? 16000),
          ]).then(([player, micCleanup]) => {
            this.player = player;
            this.micCleanup = micCleanup;
            this.callbacks.onStateChange("listening");
          }).catch((err) => {
            console.error("Audio setup failed:", err);
            this.callbacks.onError(`Microphone access failed: ${err.message}`);
            this.callbacks.onStateChange("error");
          });
          break;
        }
        case "greeting":
          this.callbacks.onMessage({ role: "assistant", text: msg.text });
          this.callbacks.onStateChange("speaking");
          break;
        case "transcript":
          this.callbacks.onTranscript(msg.text);
          break;
        case "turn":
          this.callbacks.onMessage({ role: "user", text: msg.text });
          this.callbacks.onTranscript("");
          break;
        case "thinking":
          this.callbacks.onStateChange("thinking");
          break;
        case "chat":
          this.callbacks.onMessage({
            role: "assistant",
            text: msg.text,
            steps: msg.steps,
          });
          this.callbacks.onStateChange("speaking");
          break;
        case "tts_done":
          this.callbacks.onStateChange("listening");
          break;
        case "cancelled":
          this.player?.flush();
          this.callbacks.onStateChange("listening");
          break;
        case "error":
          console.error("Agent error:", msg.message);
          this.callbacks.onError(msg.message);
          this.callbacks.onStateChange("error");
          break;
      }
    };

    ws.onclose = () => this.callbacks.onStateChange("connecting");
  }

  cancel(): void {
    this.ws?.send(JSON.stringify({ type: "cancel" }));
    this.player?.flush();
  }

  reset(): void {
    this.ws?.send(JSON.stringify({ type: "reset" }));
    this.player?.flush();
  }

  disconnect(): void {
    this.micCleanup?.();
    this.player?.close();
    this.ws?.close();
  }
}
