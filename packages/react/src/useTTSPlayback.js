import { useRef, useCallback, useEffect } from "react";
import { parseNDJSON } from "./ndjson";

function decodeBase64PCMRaw(data) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const sampleCount = (bin.length & ~1) >> 1;
  return { int16: new Int16Array(bytes.buffer, 0, sampleCount), sampleCount };
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
      let nextTime = 0;
      let sampleRate = 24000;

      for await (const msg of parseNDJSON(resp)) {
        if (msg.type === "reply") {
          if (msg.sample_rate) sampleRate = msg.sample_rate;
          if (onReply) onReply(msg);
        } else if (msg.type === "audio") {
          let ttsCtx = ttsContextRef.current;
          if (!ttsCtx || ttsCtx.state === "closed") {
            ttsCtx = new AudioContext({ sampleRate });
            ttsContextRef.current = ttsCtx;
            speakingRef.current = true;
            nextTime = ttsCtx.currentTime;
            if (onSpeaking) onSpeaking();
          } else if (ttsCtx.state === "suspended") {
            await ttsCtx.resume();
            speakingRef.current = true;
            nextTime = ttsCtx.currentTime;
            if (onSpeaking) onSpeaking();
          }

          const { int16, sampleCount } = decodeBase64PCMRaw(msg.data);
          const buffer = ttsCtx.createBuffer(1, sampleCount, ttsCtx.sampleRate);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < sampleCount; i++) channel[i] = int16[i] / 32768;

          const source = ttsCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(ttsCtx.destination);

          const startTime = Math.max(ttsCtx.currentTime, nextTime);
          source.start(startTime);
          nextTime = startTime + buffer.duration;
        } else if (msg.type === "done") {
          const ttsCtx = ttsContextRef.current;
          if (!ttsCtx || ttsCtx.state === "closed") continue;
          const endDelay = Math.max(0, nextTime - ttsCtx.currentTime);
          setTimeout(() => {
            if (ttsContextRef.current === ttsCtx) {
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
