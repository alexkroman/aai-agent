// core.ts — Shared: WS protocol, tool serialization, audio capture + playback.
// This is bundled into client.js and react.js served by the platform.

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking";

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
  const source = ctx.createMediaStreamSource(stream);

  const workletCode = `
    class PCM16Processor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0][0];
        if (input) {
          const int16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
        }
        return true;
      }
    }
    registerProcessor("pcm16", PCM16Processor);
  `;
  const blob = new Blob([workletCode], { type: "application/javascript" });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));

  const worklet = new AudioWorkletNode(ctx, "pcm16");
  worklet.port.onmessage = (e) => {
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

// ── Audio playback (PCM16 buffer queue) ─────────────────────────

export interface AudioPlayer {
  enqueue(pcm16Buffer: ArrayBuffer): void;
  flush(): void;
  close(): void;
}

export function createAudioPlayer(sampleRate: number): AudioPlayer {
  let ctx = new AudioContext({ sampleRate });
  let nextTime = 0;

  return {
    enqueue(pcm16Buffer: ArrayBuffer) {
      if (ctx.state === "closed") return;

      const int16 = new Int16Array(pcm16Buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextTime);
      source.start(startTime);
      nextTime = startTime + audioBuffer.duration;
    },
    flush() {
      ctx.close().catch(() => {});
      ctx = new AudioContext({ sampleRate });
      nextTime = 0;
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
          this.player = createAudioPlayer(msg.ttsSampleRate ?? 24000);
          startMicCapture(ws, msg.sampleRate ?? 16000).then((cleanup) => {
            this.micCleanup = cleanup;
          });
          this.callbacks.onStateChange("listening");
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
