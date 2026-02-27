import { getPlaybackWorkletUrl } from "./stream-processor-worklet";

/**
 * Plays streaming PCM16 audio via a persistent AudioWorklet node.
 *
 * The node stays alive for the entire session. Each TTS response is
 * a write/flush cycle — the worklet resets automatically after each
 * stream finishes, ready for the next one.
 *
 * Usage:
 *   const player = new PCMPlayer();
 *   await player.init(audioContext);
 *   player.write(chunk);        // feed PCM16 data
 *   player.flush();             // signal end of stream
 *   player.clear();             // barge-in, drop queued audio
 *   player.destroy();           // full cleanup
 */
export class PCMPlayer {
  private node: AudioWorkletNode | null = null;
  private context: AudioContext | null = null;
  onStarted: (() => void) | null = null;
  onDone: (() => void) | null = null;

  /**
   * Load the worklet module and create the persistent playback node.
   * Call this with an AudioContext created during a user gesture.
   */
  async init(context: AudioContext): Promise<void> {
    this.context = context;
    if (context.state === "suspended") {
      await context.resume();
    }
    await context.audioWorklet.addModule(getPlaybackWorkletUrl());

    const node = new AudioWorkletNode(context, "playback_processor");
    node.connect(context.destination);
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data.event === "started") this.onStarted?.();
      else if (e.data.event === "done") this.onDone?.();
    };
    this.node = node;
  }

  /** Feed a PCM16 chunk (ArrayBuffer or Int16Array) to the player. */
  write(data: ArrayBuffer | Int16Array): void {
    if (!this.node) return;
    const samples =
      data instanceof Int16Array ? data : new Int16Array(data);
    this.node.port.postMessage({ event: "write", samples });
  }

  /** Signal that no more data is coming for this stream.
   *  The worklet will play remaining audio then fire onDone. */
  flush(): void {
    this.node?.port.postMessage({ event: "flush" });
  }

  /** Drop all queued audio immediately (barge-in). */
  clear(): void {
    this.node?.port.postMessage({ event: "clear" });
  }

  /** Full cleanup — disconnect node and close context. */
  destroy(): void {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    if (this.context && this.context.state !== "closed") {
      this.context.close();
    }
    this.context = null;
    this.onStarted = null;
    this.onDone = null;
  }
}
