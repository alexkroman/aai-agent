// lib/audio.ts — PCM16 mic capture + audio playback. Do not edit.

/**
 * Capture mic audio as PCM16 LE and send binary frames over WebSocket.
 * Uses AudioWorklet (not deprecated ScriptProcessorNode).
 * Returns a cleanup function to stop capture.
 */
export async function startMicCapture(
  ws: WebSocket,
  sampleRate: number
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new AudioContext({ sampleRate });
  const source = ctx.createMediaStreamSource(stream);

  // Register AudioWorklet for PCM16 encoding
  const workletCode = `
    class PCM16Processor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0]?.[0];
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

/**
 * Audio player that buffers PCM16 LE chunks and plays them sequentially.
 */
export function createAudioPlayer(sampleRate: number) {
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
      // Cancel pending audio by closing and recreating context
      ctx.close().catch(() => {});
      ctx = new AudioContext({ sampleRate });
      nextTime = 0;
    },

    close() {
      ctx.close().catch(() => {});
    },
  };
}
