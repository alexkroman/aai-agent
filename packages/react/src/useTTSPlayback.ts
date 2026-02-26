import { useRef, useCallback, useEffect } from "react";
import type { TTSHandlers } from "./types";

/**
 * Hook that manages TTS audio playback via a WebSocket connection
 * to the server's /tts proxy endpoint. The server keeps the TTS API key
 * private and relays binary PCM audio frames to the browser.
 *
 * Protocol:
 *   Browser → Server:  {"text": "..."} to synthesize, {"type": "cancel"} to abort
 *   Server → Browser:  binary PCM16 LE frames, then {"type": "done"}
 */
export function useTTSPlayback() {
  const wsRef = useRef<WebSocket | null>(null);
  const ttsContextRef = useRef<AudioContext | null>(null);
  const speakingRef = useRef(false);
  const handlersRef = useRef<TTSHandlers>({});
  const nextTimeRef = useRef(0);
  const sampleRateRef = useRef(24000);

  const stop = useCallback(() => {
    if (ttsContextRef.current && ttsContextRef.current.state !== "closed") {
      ttsContextRef.current.close();
    }
    ttsContextRef.current = null;
    speakingRef.current = false;
    // Tell server to cancel any in-flight synthesis
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cancel" }));
    }
  }, []);

  const connect = useCallback(
    (url: string, sampleRate: number = 24000) =>
      new Promise<WebSocket>((resolve, reject) => {
        // Convert relative/http URL to ws/wss
        let wsUrl: string;
        if (url.startsWith("ws://") || url.startsWith("wss://")) {
          wsUrl = url;
        } else if (url.startsWith("http")) {
          wsUrl = url.replace(/^http/, "ws");
        } else {
          const u = new URL(url, window.location.href);
          u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = u.href;
        }

        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        sampleRateRef.current = sampleRate;

        ws.onopen = () => {
          wsRef.current = ws;
          resolve(ws);
        };
        ws.onerror = (e) => reject(e);
        ws.onmessage = (evt: MessageEvent) => {
          if (evt.data instanceof ArrayBuffer) {
            // Binary audio chunk — decode PCM16 LE and schedule playback
            let ttsCtx = ttsContextRef.current;
            if (!ttsCtx || ttsCtx.state === "closed") {
              ttsCtx = new AudioContext({
                sampleRate: sampleRateRef.current,
              });
              ttsContextRef.current = ttsCtx;
              speakingRef.current = true;
              nextTimeRef.current = ttsCtx.currentTime;
              handlersRef.current.onSpeaking?.();
            } else if (ttsCtx.state === "suspended") {
              ttsCtx.resume();
              speakingRef.current = true;
              nextTimeRef.current = ttsCtx.currentTime;
              handlersRef.current.onSpeaking?.();
            }

            const int16 = new Int16Array(evt.data);
            const buffer = ttsCtx.createBuffer(
              1,
              int16.length,
              sampleRateRef.current,
            );
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < int16.length; i++)
              channel[i] = int16[i] / 32768;

            const source = ttsCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(ttsCtx.destination);

            const startTime = Math.max(
              ttsCtx.currentTime,
              nextTimeRef.current,
            );
            source.start(startTime);
            nextTimeRef.current = startTime + buffer.duration;
          } else if (typeof evt.data === "string") {
            // JSON message from server
            try {
              const msg = JSON.parse(evt.data) as { type?: string };
              if (msg.type === "done") {
                const ttsCtx = ttsContextRef.current;
                if (ttsCtx && ttsCtx.state !== "closed") {
                  const endDelay = Math.max(
                    0,
                    nextTimeRef.current - ttsCtx.currentTime,
                  );
                  setTimeout(() => {
                    if (ttsContextRef.current === ttsCtx) {
                      speakingRef.current = false;
                      handlersRef.current.onDone?.();
                    }
                  }, endDelay * 1000);
                } else {
                  speakingRef.current = false;
                  handlersRef.current.onDone?.();
                }
              }
            } catch {
              // Ignore non-JSON text messages
            }
          }
        };
      }),
    [],
  );

  const speak = useCallback(
    (text: string, handlers: TTSHandlers = {}) => {
      handlersRef.current = handlers;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Stop any current playback first
        if (ttsContextRef.current && ttsContextRef.current.state !== "closed") {
          ttsContextRef.current.close();
        }
        ttsContextRef.current = null;
        speakingRef.current = false;
        ws.send(JSON.stringify({ text }));
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    stop();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [stop]);

  useEffect(() => disconnect, [disconnect]);

  return { connect, speak, stop, disconnect, speakingRef };
}
