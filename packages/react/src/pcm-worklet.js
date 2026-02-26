/**
 * PCM AudioWorklet source, inlined as a string so it can be loaded
 * via Blob URL — no static file hosting required.
 */
const PCM_WORKLET_SOURCE = /* js */ `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._target = 1600;
    this._buf = new Int16Array(this._target);
    this._pos = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf[this._pos++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._pos >= this._target) {
        this.port.postMessage(this._buf.buffer, [this._buf.buffer]);
        this._buf = new Int16Array(this._target);
        this._pos = 0;
      }
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
