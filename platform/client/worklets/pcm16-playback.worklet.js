// PCM16 playback processor — receives float32 samples and outputs them.
// Uses a pre-allocated ring buffer, pre-buffering, and fade-out/fade-in
// to eliminate clicking and popping artifacts.

const CAPACITY = 96000; // ~4s at 24 kHz
const PRE_BUFFER = 4800; // 200ms at 24 kHz — absorb network jitter
const FADE_SAMPLES = 64; // ~2.7ms at 24 kHz — smooth transitions

class PCM16PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ring = new Float32Array(CAPACITY);
    this._readPos = 0;
    this._writePos = 0;
    this._started = false;
    this._draining = false;
    this._lastSample = 0;

    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        this._readPos = 0;
        this._writePos = 0;
        this._started = false;
        this._draining = false;
        this._lastSample = 0;
        return;
      }
      // Copy incoming samples into ring buffer at writePos
      const incoming = e.data;
      const len = incoming.length;
      const cap = CAPACITY;
      const wp = this._writePos;
      const firstChunk = Math.min(len, cap - wp);
      this._ring.set(incoming.subarray(0, firstChunk), wp);
      if (firstChunk < len) {
        this._ring.set(incoming.subarray(firstChunk), 0);
      }
      this._writePos = (wp + len) % cap;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;

    const cap = CAPACITY;
    const available = (this._writePos - this._readPos + cap) % cap;

    // Pre-buffer: wait until enough data before starting playback
    if (!this._started) {
      if (available < PRE_BUFFER) {
        for (let i = 0; i < output.length; i++) output[i] = 0;
        return true;
      }
      this._started = true;
    }

    const outLen = output.length;
    const n = Math.min(available, outLen);

    // Fade-in after an underrun gap
    if (this._draining && n > 0) {
      this._draining = false;
      const fadeLen = Math.min(FADE_SAMPLES, n);
      let rp = this._readPos;
      for (let i = 0; i < fadeLen; i++) {
        const t = (i + 1) / fadeLen;
        output[i] = this._ring[rp] * t;
        rp = (rp + 1) % cap;
      }
      for (let i = fadeLen; i < n; i++) {
        output[i] = this._ring[rp];
        rp = (rp + 1) % cap;
      }
      this._readPos = rp;
    } else if (n > 0) {
      // Normal copy from ring buffer
      let rp = this._readPos;
      for (let i = 0; i < n; i++) {
        output[i] = this._ring[rp];
        rp = (rp + 1) % cap;
      }
      this._readPos = rp;
    }

    if (n > 0) {
      this._lastSample = output[n - 1];
    }

    // Fade-out on underrun: ramp from _lastSample to 0
    if (n < outLen) {
      this._draining = true;
      const remaining = outLen - n;
      for (let i = 0; i < remaining; i++) {
        const t = 1 - (i + 1) / remaining;
        output[n + i] = this._lastSample * t;
      }
      this._lastSample = 0;
    }

    return true;
  }
}
registerProcessor("pcm16-playback", PCM16PlaybackProcessor);
