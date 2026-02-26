import { useRef, useCallback, useEffect } from "react";
import { WavStreamPlayer } from "./wav-stream-player";
import { openWebSocket, closeWebSocket } from "./ws";
import type { TTSHandlers } from "./types";

/**
 * Hook that manages TTS audio playback via a WebSocket connection
 * to the server's /tts proxy endpoint. Uses a WavStreamPlayer
 * (AudioWorklet-based, ported from OpenAI's wavtools) for smooth,
 * zero-GC streaming playback of PCM16 LE audio.
 *
 * Protocol:
 *   Browser → Server:  {"text": "..."} to synthesize, {"type": "cancel"} to abort
 *   Server → Browser:  binary PCM16 LE frames, then {"type": "done"}
 */
export function useTTSPlayback() {
  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<WavStreamPlayer | null>(null);
  const speakingRef = useRef(false);
  const handlersRef = useRef<TTSHandlers>({});
  const speakGenRef = useRef(0);

  const connect = useCallback(
    async (url: string, sampleRate: number = 24000) => {
      const player = new WavStreamPlayer({ sampleRate });
      await player.connect();
      playerRef.current = player;

      const ws = await openWebSocket(url, {
        onMessage: (evt) => {
          if (evt.data instanceof ArrayBuffer) {
            playerRef.current?.add16BitPCM(evt.data);
          }
          // Server "done" message is not needed — the worklet auto-stops
          // when its buffer drains after playback has started.
        },
      });
      socketRef.current = ws;
      return ws;
    },
    [],
  );

  const stop = useCallback(() => {
    speakGenRef.current++; // Invalidate pending callbacks from previous speak
    speakingRef.current = false;
    playerRef.current?.clear();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "cancel" }));
    }
  }, []);

  const speak = useCallback(
    async (text: string, handlers: TTSHandlers = {}) => {
      const ws = socketRef.current;
      const player = playerRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !player) return;

      // Clear any current playback before changing handlers
      player.clear();
      speakingRef.current = false;

      // Bump generation so stale callbacks from old playback are ignored
      const gen = ++speakGenRef.current;
      handlersRef.current = handlers;

      // Wire callbacks scoped to this utterance's generation
      player.setCallbacks({
        onSpeaking: () => {
          if (speakGenRef.current !== gen) return;
          speakingRef.current = true;
          handlersRef.current.onSpeaking?.();
        },
        onDone: () => {
          if (speakGenRef.current !== gen) return;
          speakingRef.current = false;
          handlersRef.current.onDone?.();
        },
      });

      ws.send(JSON.stringify({ text }));
    },
    [],
  );

  const disconnect = useCallback(() => {
    stop();
    closeWebSocket(socketRef.current);
    socketRef.current = null;
    if (playerRef.current) {
      playerRef.current.disconnect();
      playerRef.current = null;
    }
  }, [stop]);

  useEffect(() => disconnect, [disconnect]);

  return { connect, speak, stop, disconnect, speakingRef };
}
