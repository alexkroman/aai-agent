/**
 * Playback AudioWorklet — receives Int16 PCM from the main thread,
 * converts to Float32, and plays through the audio output.
 *
 * Inlined as a string so it can be loaded via Blob URL.
 *
 * Design: a simple FIFO queue of Float32 sample arrays. process()
 * drains the queue directly into the output buffer — no intermediate
 * 128-sample slicing. The node stays alive for the whole session;
 * it resets automatically after each stream finishes.
 *
 * Pre-buffer: playback waits until 200ms of audio (4800 samples at
 * 24kHz) has been queued before starting, to avoid micro-gaps caused
 * by slow or bursty chunk delivery. Once playback starts, it drains
 * continuously. The pre-buffer is skipped on flush (short utterances).
 *
 * Messages FROM main thread:
 *   { event: "write", samples: Int16Array }  — add audio data
 *   { event: "flush" }                       — no more data coming
 *   { event: "clear" }                       — barge-in, drop all
 *
 * Messages TO main thread:
 *   { event: "started" }  — first samples are being output
 *   { event: "done" }     — all queued audio has been played
 */
const PLAYBACK_WORKLET_SOURCE = /* js */ `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queued = 0;
    this.current = null;
    this.offset = 0;
    this.started = false;
    this.finished = false;
    this.prebuffer = 4800; // 200ms at 24kHz

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.event === 'write') {
        const int16 = msg.samples;
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768;
        }
        this.queue.push(float32);
        this.queued += float32.length;
      } else if (msg.event === 'flush') {
        this.finished = true;
      } else if (msg.event === 'clear') {
        this.queue = [];
        this.queued = 0;
        this.current = null;
        this.offset = 0;
        this.started = false;
        this.finished = false;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;

    // Wait for pre-buffer before starting playback (skip if flushed)
    if (!this.started && !this.finished && this.queued < this.prebuffer) {
      for (let i = 0; i < output.length; i++) output[i] = 0;
      return true;
    }

    let written = 0;

    while (written < output.length) {
      // Need a new chunk from the queue?
      if (!this.current || this.offset >= this.current.length) {
        if (this.queue.length > 0) {
          this.current = this.queue.shift();
          this.offset = 0;
          if (!this.started) {
            this.started = true;
            this.port.postMessage({ event: 'started' });
          }
        } else {
          // Queue empty — check if stream is done
          if (this.finished) {
            this.started = false;
            this.finished = false;
            this.current = null;
            this.offset = 0;
            this.queued = 0;
            this.port.postMessage({ event: 'done' });
          }
          // Fill remaining output with silence
          for (let i = written; i < output.length; i++) {
            output[i] = 0;
          }
          return true;
        }
      }

      // Copy samples from current chunk to output
      const available = this.current.length - this.offset;
      const needed = output.length - written;
      const count = Math.min(available, needed);
      for (let i = 0; i < count; i++) {
        output[written + i] = this.current[this.offset + i];
      }
      written += count;
      this.offset += count;
    }

    return true;
  }
}

registerProcessor('playback_processor', PlaybackProcessor);
`;

let workletUrl: string | null = null;

export function getPlaybackWorkletUrl(): string {
  if (!workletUrl) {
    const blob = new Blob([PLAYBACK_WORKLET_SOURCE], {
      type: "application/javascript",
    });
    workletUrl = URL.createObjectURL(blob);
  }
  return workletUrl;
}
