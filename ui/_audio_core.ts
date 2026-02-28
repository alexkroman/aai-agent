import { MIC_BUFFER_SECONDS } from "./types.ts";

export async function loadWorklet(
  ctx: AudioContext,
  source: string,
): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "application/javascript" }),
  );
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface MicCapture {
  close(): void;
}

export async function startMicCapture(
  ws: WebSocket,
  sampleRate: number,
  workletSource: string,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new AudioContext({ sampleRate });
  try {
    await ctx.resume();
    await loadWorklet(ctx, workletSource);

    const source = ctx.createMediaStreamSource(stream);
    const minSamples = Math.floor(sampleRate * MIC_BUFFER_SECONDS);
    const worklet = new AudioWorkletNode(ctx, "pcm16", {
      processorOptions: { minSamples },
    });
    worklet.port.onmessage = (e: MessageEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    source.connect(worklet);
    worklet.connect(ctx.destination);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    throw err;
  }

  return {
    close() {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

export interface AudioPlayer {
  enqueue(pcm16Buffer: ArrayBuffer): void;
  flush(): void;
  close(): void;
}

export async function createAudioPlayer(
  sampleRate: number,
  workletSource: string,
): Promise<AudioPlayer> {
  const ctx = new AudioContext({ sampleRate });
  await ctx.resume();
  await loadWorklet(ctx, workletSource);

  const worklet = new AudioWorkletNode(ctx, "pcm16-playback");
  worklet.connect(ctx.destination);

  return {
    enqueue(pcm16Buffer: ArrayBuffer) {
      if (ctx.state === "closed") return;
      worklet.port.postMessage(pcm16Buffer, [pcm16Buffer]);
    },
    flush() {
      worklet.port.postMessage("flush");
    },
    close() {
      ctx.close().catch(() => {});
    },
  };
}
