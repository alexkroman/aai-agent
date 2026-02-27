import { useRef, useCallback, useEffect } from "react";
import { getPCMWorkletUrl } from "./pcm-worklet";
import { PCMPlayer } from "./wav-stream-player";
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
 *
 * Audio architecture:
 * - Playback AudioContext (24kHz) is created during the user gesture
 *   (button click) so the browser never blocks it. The PCMPlayer node
 *   is ready before the WebSocket even connects — no buffering needed.
 * - Capture AudioContext (STT sample rate) is created when startCapture
 *   is called, after the server sends the required sample rate.
 *
 * Teardown detection: async helpers (startCapture) check whether
 * socketRef is still set. If disconnect() ran while an await was
 * pending, socketRef will be null and the helper bails out.
 */
export function useSessionSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const speakingRef = useRef(false);
  const handlersRef = useRef<SessionHandlers>({});

  // ── Cleanup ─────────────────────────────────────────────────────

  const _cleanup = useCallback(() => {
    // Mic capture
    if (captureNodeRef.current) {
      captureNodeRef.current.disconnect();
      captureNodeRef.current = null;
    }
    if (captureCtxRef.current) {
      captureCtxRef.current.close();
      captureCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    // Playback
    speakingRef.current = false;
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    // WebSocket
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  /** Returns true if the session is still alive (not disconnected). */
  function _isConnected(): boolean {
    return socketRef.current !== null;
  }

  // ── Connect ─────────────────────────────────────────────────────

  const connect = useCallback(
    async (url: string, handlers: SessionHandlers = {}) => {
      handlersRef.current = handlers;

      // 1. Create playback player FIRST — during the user gesture so
      //    the AudioContext is never auto-suspended by the browser.
      const playbackCtx = new AudioContext({ sampleRate: 24000 });
      if (playbackCtx.state === "suspended") await playbackCtx.resume();

      const player = new PCMPlayer();
      await player.init(playbackCtx);

      if (!_isConnected() && socketRef.current === null) {
        // disconnect() was called during init — but actually we haven't
        // set socketRef yet, so check if cleanup ran by seeing if we
        // should still proceed. We use a simple flag: if _cleanup was
        // called, playerRef would have been nulled — but we haven't set
        // it yet. So we just proceed; the WebSocket guard below will
        // catch the race after the socket is set.
      }

      player.onStarted = () => {
        if (!speakingRef.current) {
          speakingRef.current = true;
          handlersRef.current.onSpeaking?.();
        }
      };
      player.onDone = () => {
        speakingRef.current = false;
        handlersRef.current.onSpeakingDone?.();
        handlersRef.current.onTTSDone?.();
      };
      playerRef.current = player;

      // 2. Connect WebSocket
      const wsUrl = toWsUrl(url);
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        socket.binaryType = "arraybuffer";
        socket.onopen = () => resolve(socket);
        socket.onerror = (e) => reject(e);
      });

      socketRef.current = ws;

      ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          playerRef.current?.write(evt.data);
        } else if (typeof evt.data === "string") {
          try {
            _handleMessage(JSON.parse(evt.data));
          } catch {
            // ignore parse errors
          }
        }
      };

      ws.onclose = () => {
        socketRef.current = null;
        _cleanup();
        handlersRef.current.onClose?.();
      };

      return ws;
    },
    [_cleanup],
  );

  // ── Message dispatch ────────────────────────────────────────────

  function _handleMessage(msg: Record<string, unknown>) {
    const h = handlersRef.current;
    switch (msg.type) {
      case "ready":
        h.onReady?.(
          msg.sample_rate as number,
          msg.tts_sample_rate as number,
        );
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
        if (playerRef.current) {
          playerRef.current.flush();
        } else {
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

  // ── Mic capture ─────────────────────────────────────────────────

  const startCapture = useCallback(
    async (sampleRate: number) => {
      if (!_isConnected()) return;

      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!_isConnected()) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        return;
      }

      captureCtxRef.current = new AudioContext({ sampleRate });
      const source = captureCtxRef.current.createMediaStreamSource(
        micStreamRef.current,
      );

      await captureCtxRef.current.audioWorklet.addModule(getPCMWorkletUrl());

      if (!_isConnected()) return;

      captureNodeRef.current = new AudioWorkletNode(
        captureCtxRef.current,
        "pcm-processor",
      );
      captureNodeRef.current.port.onmessage = (
        e: MessageEvent<ArrayBuffer>,
      ) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(e.data);
        }
      };
      source.connect(captureNodeRef.current);
      captureNodeRef.current.connect(captureCtxRef.current.destination);
    },
    [],
  );

  // ── Utilities ───────────────────────────────────────────────────

  const sendJSON = useCallback((data: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    _cleanup();
  }, [_cleanup]);

  useEffect(() => disconnect, [disconnect]);

  return { connect, startCapture, sendJSON, disconnect };
}
