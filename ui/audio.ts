// audio.ts — Microphone capture and audio playback via AudioWorklet.

import { MIC_BUFFER_SECONDS } from "./types.ts";

// Worklet source is inlined as text by esbuild (text loader for .worklet.js)
// @ts-ignore — esbuild text import, default export is a string at runtime
import pcm16CaptureWorklet from "./worklets/pcm16-capture.worklet.js";
// @ts-ignore — esbuild text import, default export is a string at runtime
import pcm16PlaybackWorklet from "./worklets/pcm16-playback.worklet.js";

// ── Audio capture (PCM16 via AudioWorklet) ──────────────────────

export async function startMicCapture(
  ws: WebSocket,
  sampleRate: number,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new AudioContext({ sampleRate });
  await ctx.resume();
  console.log(
    "[mic] AudioContext state:",
    ctx.state,
    "sampleRate:",
    ctx.sampleRate,
  );
  const source = ctx.createMediaStreamSource(stream);

  // Buffer ~100ms of audio (1600 samples at 16kHz) before sending.
  // AssemblyAI requires frames between 50-1000ms; AudioWorklet's
  // process() fires every 128 samples (8ms) which is too small.
  const minSamples = Math.floor(sampleRate * MIC_BUFFER_SECONDS);
  const blob = new Blob([pcm16CaptureWorklet as unknown as string], {
    type: "application/javascript",
  });
  const blobUrl = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  let frameCount = 0;
  const worklet = new AudioWorkletNode(ctx, "pcm16", {
    processorOptions: { minSamples },
  });
  worklet.port.onmessage = (e: MessageEvent) => {
    frameCount++;
    if (frameCount <= 3) {
      console.log(
        "[mic] Frame",
        frameCount,
        "bytes:",
        e.data.byteLength,
        "wsReady:",
        ws.readyState,
      );
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(e.data);
    }
  };
  source.connect(worklet);
  worklet.connect(ctx.destination);

  return () => {
    stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
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
  sampleRate: number,
): Promise<AudioPlayer> {
  const ctx = new AudioContext({ sampleRate });
  await ctx.resume(); // Ensure AudioContext is not suspended (autoplay policy)

  const blob = new Blob([pcm16PlaybackWorklet as unknown as string], {
    type: "application/javascript",
  });
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
