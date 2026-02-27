// PCM16 playback processor — receives float32 samples and outputs them.
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
