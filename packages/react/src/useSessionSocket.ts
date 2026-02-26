import { useRef, useCallback, useEffect } from "react";
import { getPCMWorkletUrl } from "./pcm-worklet";
import { WavStreamPlayer } from "./wav-stream-player";
import { toWsUrl } from "./ws";

export interface SessionHandlers {
  onReady?: (sampleRate: number, ttsSampleRate: number) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onTurn?: (text: string) => void;
  onThinking?: () => void;
  onChat?: (text: string, steps: string[]) => void;
  onGreeting?: (text: string) => void;
  onTTSDone?: () => void;
  onError?: (message: string) => void;
  onCancelled?: () => void;
  onReset?: () => void;
  onSpeaking?: () => void;
  onSpeakingDone?: () => void;
  onClose?: () => void;
}

/**
 * Hook that manages a single multiplexed WebSocket to the server's
 * /session endpoint. The browser is a thin audio I/O client:
 * send mic PCM, receive speaker PCM, receive UI update messages.
 */
export function useSessionSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<WavStreamPlayer | null>(null);
  const speakingRef = useRef(false);
  const handlersRef = useRef<SessionHandlers>({});
  // Generation counter: incremented on connect/disconnect to invalidate
  // stale async operations (e.g. initPlayer/startCapture completing after
  // disconnect was called).
  const generationRef = useRef(0);

  /** Release all local resources (mic, player, WebSocket). */
  const _cleanup = useCallback(() => {
    generationRef.current++;

    // Stop mic capture
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Stop player
    speakingRef.current = false;
    if (playerRef.current) {
      playerRef.current.disconnect();
      playerRef.current = null;
    }

    // Close WebSocket
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const connect = useCallback(
    async (url: string, handlers: SessionHandlers = {}) => {
      handlersRef.current = handlers;
      const gen = ++generationRef.current;

      const wsUrl = toWsUrl(url);
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        socket.binaryType = "arraybuffer";
        socket.onopen = () => resolve(socket);
        socket.onerror = (e) => reject(e);
      });

      // Guard: disconnect was called while WebSocket was connecting
      if (gen !== generationRef.current) {
        ws.close();
        return ws;
      }

      ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          // Binary: TTS audio from server
          if (!playerRef.current) return;
          if (!speakingRef.current) {
            speakingRef.current = true;
            handlersRef.current.onSpeaking?.();
          }
          playerRef.current.add16BitPCM(evt.data);
        } else if (typeof evt.data === "string") {
          // JSON: server message
          try {
            const msg = JSON.parse(evt.data);
            _handleMessage(msg);
          } catch {
            // ignore parse errors
          }
        }
      };

      ws.onclose = () => {
        // Server-initiated close: full cleanup + notify UI
        socketRef.current = null;
        _cleanup();
        handlersRef.current.onClose?.();
      };

      socketRef.current = ws;
      return ws;
    },
    [_cleanup],
  );

  function _handleMessage(msg: Record<string, unknown>) {
    const h = handlersRef.current;
    switch (msg.type) {
      case "ready":
        h.onReady?.(msg.sample_rate as number, msg.tts_sample_rate as number);
        break;
      case "transcript":
        h.onTranscript?.(msg.text as string, msg.final as boolean);
        break;
      case "turn":
        h.onTurn?.(msg.text as string);
        break;
      case "thinking":
        h.onThinking?.();
        break;
      case "chat":
        h.onChat?.(msg.text as string, (msg.steps as string[]) || []);
        break;
      case "greeting":
        h.onGreeting?.(msg.text as string);
        break;
      case "tts_done":
        // Server finished sending audio bytes. If no audio was played
        // (TTS disabled), fire immediately. Otherwise let WavStreamPlayer
        // onDone handle the transition when audio finishes playing.
        if (!speakingRef.current) {
          h.onTTSDone?.();
        }
        break;
      case "error":
        h.onError?.(msg.message as string);
        break;
      case "cancelled":
        speakingRef.current = false;
        playerRef.current?.clear();
        h.onCancelled?.();
        break;
      case "reset":
        h.onReset?.();
        break;
    }
  }

  const startCapture = useCallback(async (sampleRate: number, gen: number) => {
    // Guard: session was torn down before this async call ran
    if (gen !== generationRef.current) return;

    streamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Guard: disconnect called while awaiting getUserMedia
    if (gen !== generationRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }

    audioContextRef.current = new AudioContext({ sampleRate });
    const source = audioContextRef.current.createMediaStreamSource(
      streamRef.current,
    );

    await audioContextRef.current.audioWorklet.addModule(getPCMWorkletUrl());

    // Guard: disconnect called while awaiting addModule
    if (gen !== generationRef.current) return;

    workletNodeRef.current = new AudioWorkletNode(
      audioContextRef.current,
      "pcm-processor",
    );
    workletNodeRef.current.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(e.data);
      }
    };
    source.connect(workletNodeRef.current);
    workletNodeRef.current.connect(audioContextRef.current.destination);
  }, []);

  const initPlayer = useCallback(async (sampleRate: number, gen: number) => {
    // Guard: session was torn down before this async call ran
    if (gen !== generationRef.current) return;

    const player = new WavStreamPlayer({ sampleRate });
    await player.connect();

    // Guard: disconnect called while awaiting connect
    if (gen !== generationRef.current) {
      player.disconnect();
      return;
    }

    player.setCallbacks({
      onDone: () => {
        speakingRef.current = false;
        handlersRef.current.onSpeakingDone?.();
        handlersRef.current.onTTSDone?.();
      },
    });
    playerRef.current = player;
  }, []);

  const disconnect = useCallback(() => {
    _cleanup();
  }, [_cleanup]);

  useEffect(() => disconnect, [disconnect]);

  return {
    connect,
    startCapture,
    initPlayer,
    disconnect,
    generationRef,
  };
}
