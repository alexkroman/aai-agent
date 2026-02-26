/**
 * Stream processor AudioWorklet — ported from OpenAI's wavtools.
 * Inlined as a string so it can be loaded via Blob URL (no static
 * file hosting required).
 *
 * Design: incoming Int16 PCM is converted to Float32 and pre-sliced
 * into 128-sample buffers (matching the Web Audio render quantum).
 * process() shifts one buffer per call — no partial fills, no pops.
 * Auto-stops when the queue drains after playback has started.
 *
 * Messages FROM main thread:
 *   { event: "write", buffer: Int16Array, trackId: string }
 *   { event: "offset", requestId: string }
 *   { event: "interrupt", requestId: string }
 *
 * Messages TO main thread:
 *   { event: "stop" }
 *   { event: "offset", requestId, trackId, offset }
 */
const STREAM_PROCESSOR_SOURCE = /* js */ `
class StreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hasStarted = false;
    this.hasInterrupted = false;
    this.outputBuffers = [];
    this.bufferLength = 128;
    this.write = { buffer: new Float32Array(this.bufferLength), trackId: null };
    this.writeOffset = 0;
    this.trackSampleOffsets = {};
    this.port.onmessage = (event) => {
      if (event.data) {
        const payload = event.data;
        if (payload.event === 'write') {
          const int16Array = payload.buffer;
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 0x8000;
          }
          this.writeData(float32Array, payload.trackId);
        } else if (
          payload.event === 'offset' ||
          payload.event === 'interrupt'
        ) {
          const requestId = payload.requestId;
          const trackId = this.write.trackId;
          const offset = this.trackSampleOffsets[trackId] || 0;
          this.port.postMessage({
            event: 'offset',
            requestId,
            trackId,
            offset,
          });
          if (payload.event === 'interrupt') {
            this.hasInterrupted = true;
          }
        }
      }
    };
  }

  writeData(float32Array, trackId = null) {
    let { buffer } = this.write;
    let offset = this.writeOffset;
    for (let i = 0; i < float32Array.length; i++) {
      buffer[offset++] = float32Array[i];
      if (offset >= buffer.length) {
        this.outputBuffers.push(this.write);
        this.write = { buffer: new Float32Array(this.bufferLength), trackId };
        buffer = this.write.buffer;
        offset = 0;
      }
    }
    this.writeOffset = offset;
    return true;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const outputChannelData = output[0];
    if (this.hasInterrupted) {
      this.port.postMessage({ event: 'stop' });
      return false;
    } else if (this.outputBuffers.length) {
      this.hasStarted = true;
      const { buffer, trackId } = this.outputBuffers.shift();
      for (let i = 0; i < outputChannelData.length; i++) {
        outputChannelData[i] = buffer[i] || 0;
      }
      if (trackId) {
        this.trackSampleOffsets[trackId] =
          this.trackSampleOffsets[trackId] || 0;
        this.trackSampleOffsets[trackId] += buffer.length;
      }
      return true;
    } else if (this.hasStarted) {
      this.port.postMessage({ event: 'stop' });
      return false;
    } else {
      return true;
    }
  }
}

registerProcessor('stream_processor', StreamProcessor);
`;

let workletUrl: string | null = null;

export function getStreamProcessorUrl(): string {
  if (!workletUrl) {
    const blob = new Blob([STREAM_PROCESSOR_SOURCE], {
      type: "application/javascript",
    });
    workletUrl = URL.createObjectURL(blob);
  }
  return workletUrl;
}
