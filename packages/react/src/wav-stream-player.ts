import { getStreamProcessorUrl } from "./stream-processor-worklet";

export interface StreamPlayerCallbacks {
  onSpeaking?: () => void;
  onDone?: () => void;
}

/**
 * Plays streaming PCM16 audio via an AudioWorklet.
 * Ported from OpenAI's wavtools WavStreamPlayer — stripped of
 * AudioAnalysis and frequency helpers we don't need.
 *
 * Usage:
 *   const player = new WavStreamPlayer({ sampleRate: 24000 });
 *   await player.connect();
 *   player.setCallbacks({ onSpeaking, onDone });
 *   player.add16BitPCM(chunk);   // call for each binary frame
 *   player.clear();               // instant barge-in
 *   player.disconnect();          // full cleanup
 */
export class WavStreamPlayer {
  private sampleRate: number;
  private context: AudioContext | null = null;
  private stream: AudioWorkletNode | null = null;
  private trackSampleOffsets: Record<
    string,
    { trackId: string; offset: number; currentTime: number }
  > = {};
  private interruptedTrackIds: Record<string, boolean> = {};
  private callbacks: StreamPlayerCallbacks = {};

  constructor({ sampleRate = 24000 }: { sampleRate?: number } = {}) {
    this.sampleRate = sampleRate;
  }

  /** Initialize AudioContext and load the worklet module. */
  async connect(): Promise<void> {
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    await this.context.audioWorklet.addModule(getStreamProcessorUrl());
  }

  /** Set callbacks fired when playback starts / finishes. */
  setCallbacks(callbacks: StreamPlayerCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Create a new AudioWorkletNode for a playback session. */
  private _start(): void {
    if (!this.context) throw new Error("Not connected");
    this.interruptedTrackIds = {};
    const node = new AudioWorkletNode(this.context, "stream_processor");
    node.connect(this.context.destination);
    node.port.onmessage = (e: MessageEvent) => {
      const { event, requestId, trackId, offset } = e.data;
      if (event === "stop") {
        node.disconnect();
        this.stream = null;
        this.callbacks.onDone?.();
      } else if (event === "offset") {
        const currentTime = offset / this.sampleRate;
        this.trackSampleOffsets[requestId] = { trackId, offset, currentTime };
      }
    };
    this.stream = node;
    this.callbacks.onSpeaking?.();
  }

  /**
   * Feed PCM16 data to the player. Accepts Int16Array or raw ArrayBuffer.
   * Auto-starts a new stream worklet node on the first chunk.
   */
  add16BitPCM(
    arrayBuffer: ArrayBuffer | Int16Array,
    trackId = "default",
  ): void {
    if (this.interruptedTrackIds[trackId]) return;
    if (!this.stream) this._start();
    const buffer =
      arrayBuffer instanceof Int16Array
        ? arrayBuffer
        : new Int16Array(arrayBuffer);
    this.stream!.port.postMessage({ event: "write", buffer, trackId });
  }

  /**
   * Interrupt playback and return the current sample offset.
   * Async — waits for the worklet to report its position.
   */
  async interrupt(): Promise<{
    trackId: string | null;
    offset: number;
    currentTime: number;
  } | null> {
    if (!this.stream) return null;
    const requestId = crypto.randomUUID();
    this.stream.port.postMessage({ event: "interrupt", requestId });
    let result: { trackId: string; offset: number; currentTime: number } | undefined;
    while (!result) {
      result = this.trackSampleOffsets[requestId];
      if (!result) await new Promise((r) => setTimeout(r, 1));
    }
    const { trackId } = result;
    if (trackId) this.interruptedTrackIds[trackId] = true;
    return result;
  }

  /**
   * Immediately stop all output (synchronous).
   * Use this for barge-in where latency matters.
   */
  clear(): void {
    if (this.stream) {
      this.stream.port.onmessage = null;
      this.stream.disconnect();
      this.stream = null;
    }
    this.interruptedTrackIds = {};
  }

  /** Full cleanup — close AudioContext and release all resources. */
  disconnect(): void {
    this.clear();
    if (this.context && this.context.state !== "closed") {
      this.context.close();
    }
    this.context = null;
    this.trackSampleOffsets = {};
  }
}
