import { useRef, useCallback, useEffect } from "react";
import { parseNDJSON } from "./ndjson";

function decodeBase64PCM(data) {
  const bin = atob(data);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(pcm.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

/**
 * Hook that manages TTS audio playback from NDJSON streams.
 * Handles base64 PCM decoding and AudioContext buffer scheduling.
 */
export function useTTSPlayback() {
  const ttsContextRef = useRef(null);
  const speakingRef = useRef(false);

  const stop = useCallback(() => {
    if (ttsContextRef.current && ttsContextRef.current.state !== "closed") {
      ttsContextRef.current.close();
    }
    ttsContextRef.current = null;
    speakingRef.current = false;
  }, []);

  const readStream = useCallback(
    async (resp, { onReply, onSpeaking, onDone } = {}) => {
      let ttsCtx = null;
      let nextTime = 0;
      let sampleRate = 24000;

      for await (const msg of parseNDJSON(resp)) {
        if (msg.type === "reply") {
          if (msg.sample_rate) sampleRate = msg.sample_rate;
          if (onReply) onReply(msg);
        } else if (msg.type === "audio") {
          if (!ttsCtx || ttsCtx.state === "closed") {
            ttsCtx = new AudioContext({ sampleRate });
            ttsContextRef.current = ttsCtx;
            speakingRef.current = true;
            nextTime = ttsCtx.currentTime;
            if (onSpeaking) onSpeaking();
          }

          const float32 = decodeBase64PCM(msg.data);
          const buffer = ttsCtx.createBuffer(1, float32.length, ttsCtx.sampleRate);
          buffer.getChannelData(0).set(float32);

          const source = ttsCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(ttsCtx.destination);

          const startTime = Math.max(ttsCtx.currentTime, nextTime);
          source.start(startTime);
          nextTime = startTime + buffer.duration;
        } else if (msg.type === "done" && ttsCtx && ttsCtx.state !== "closed") {
          const endDelay = Math.max(0, nextTime - ttsCtx.currentTime);
          const ctx = ttsCtx;
          setTimeout(() => {
            if (ttsContextRef.current === ctx) {
              ctx.close();
              ttsContextRef.current = null;
              speakingRef.current = false;
              if (onDone) onDone();
            }
          }, endDelay * 1000);
        }
      }
    },
    [],
  );

  useEffect(() => stop, [stop]);

  return { readStream, stop, speakingRef };
}
