/**
 * Mic capture AudioWorklet — converts Float32 input to Int16 PCM
 * and posts it to the main thread for WebSocket transmission.
 *
 * Inlined as a string so it can be loaded via Blob URL (no static
 * file hosting required).
 */
const PCM_WORKLET_SOURCE = /* js */ `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1600; // 100ms at 16kHz
    this.buffer = new Int16Array(this.bufferSize);
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.pos++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.pos >= this.bufferSize) {
        // Transfer buffer (zero-copy) — must allocate a new one after
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.bufferSize);
        this.pos = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
`;

let workletUrl: string | null = null;

export function getPCMWorkletUrl(): string {
  if (!workletUrl) {
    const blob = new Blob([PCM_WORKLET_SOURCE], {
      type: "application/javascript",
    });
    workletUrl = URL.createObjectURL(blob);
  }
  return workletUrl;
}
