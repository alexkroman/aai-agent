// PCM16 capture processor — buffers mic audio and sends as Int16Array.
// minSamples is passed via processorOptions at construction time.
class PCM16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._buf = [];
    this._len = 0;
    this._min = (options.processorOptions && options.processorOptions.minSamples) || 1600;
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
