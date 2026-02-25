/**
 * PCM AudioWorklet source, inlined as a string so it can be loaded
 * via Blob URL — no static file hosting required.
 */
const PCM_WORKLET_SOURCE = /* js */ `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._len = 0;
    this._target = 1600;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this._len++;
    }
    if (this._len >= this._target) {
      const pcm = new Int16Array(this._buf.splice(0, this._target));
      this._len -= this._target;
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
`;

let workletUrl = null;

export function getPCMWorkletUrl() {
  if (!workletUrl) {
    const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" });
    workletUrl = URL.createObjectURL(blob);
  }
  return workletUrl;
}
