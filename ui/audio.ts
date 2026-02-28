// esbuild inlines these as strings; Deno sees JS modules, so we cast.
import pcm16CaptureWorklet from "./worklets/pcm16-capture.worklet.js";
import pcm16PlaybackWorklet from "./worklets/pcm16-playback.worklet.js";

import {
  createAudioPlayer as _createAudioPlayer,
  startMicCapture as _startMicCapture,
} from "./_audio_core.ts";

export type { AudioPlayer, MicCapture } from "./_audio_core.ts";

export function startMicCapture(ws: WebSocket, sampleRate: number) {
  return _startMicCapture(
    ws,
    sampleRate,
    pcm16CaptureWorklet as unknown as string,
  );
}

export function createAudioPlayer(sampleRate: number) {
  return _createAudioPlayer(
    sampleRate,
    pcm16PlaybackWorklet as unknown as string,
  );
}
