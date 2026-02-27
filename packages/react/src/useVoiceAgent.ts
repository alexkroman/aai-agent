import { useCallback, useReducer, useRef, useEffect } from "react";
import { getPCMWorkletUrl } from "./pcm-worklet";
import { PCMPlayer } from "./wav-stream-player";

function toWsUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  if (url.startsWith("http")) return url.replace(/^http/, "ws");
  const u = new URL(url, window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}
import type {
  VoiceAgentOptions,
  VoiceAgentResult,
  VoiceAgentError,
  Message,
  Phase,
  TurnPhase,
} from "./types";

// ── Reducer ──────────────────────────────────────────────────────────

interface VoiceState {
  phase: Phase;
  turnPhase: TurnPhase;
  messages: Message[];
  error: VoiceAgentError | null;
}

type VoiceAction =
  | { type: "SET_PHASE"; phase: Phase; turnPhase?: TurnPhase }
  | { type: "ADD_MESSAGE"; message: Message; maxMessages: number }
  | { type: "REMOVE_MESSAGE"; id: string }
  | { type: "CLEAR_MESSAGES" }
  | { type: "SET_ERROR"; error: VoiceAgentError | null };

const initialState: VoiceState = {
  phase: "idle",
  turnPhase: "listening",
  messages: [],
  error: null,
};

function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "SET_PHASE":
      return {
        ...state,
        phase: action.phase,
        turnPhase: action.turnPhase ?? state.turnPhase,
      };
    case "ADD_MESSAGE": {
      const messages = [...state.messages, action.message];
      const max = action.maxMessages;
      if (max > 0 && messages.length > max) {
        return { ...state, messages: messages.slice(-max) };
      }
      return { ...state, messages };
    }
    case "REMOVE_MESSAGE":
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case "CLEAR_MESSAGES":
      return { ...state, messages: [] };
    case "SET_ERROR":
      return { ...state, error: action.error };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────

/**
 * React hook that manages a full voice-agent session through a single
 * multiplexed WebSocket. The server handles STT, turn detection, LLM,
 * barge-in, and TTS. The browser is a thin audio I/O client.
 *
 * Audio architecture:
 * - Playback AudioContext (24kHz) is created during the user gesture
 *   (button click) so the browser never blocks it.
 * - Capture AudioContext (STT sample rate) is created after the server
 *   sends the required sample rate in the "ready" message.
 */
export function useVoiceAgent({
  baseUrl = "",
  maxMessages = 0,
  onError,
  onConnect,
  onDisconnect,
  onTurnStart,
  onTurnEnd,
}: VoiceAgentOptions = {}): VoiceAgentResult {
  const [state, dispatch] = useReducer(voiceReducer, initialState);

  // Refs for values needed in callbacks (avoids stale closures)
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;
  const maxMessagesRef = useRef(maxMessages);
  maxMessagesRef.current = maxMessages;

  // Stable callback refs
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;
  const onTurnStartRef = useRef(onTurnStart);
  onTurnStartRef.current = onTurnStart;
  const onTurnEndRef = useRef(onTurnEnd);
  onTurnEndRef.current = onTurnEnd;

  // Session refs
  const socketRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const speakingRef = useRef(false);
  const thinkingIdRef = useRef<string | null>(null);

  // ── internal helpers ──────────────────────────────────────────────

  const addMessage = useCallback(
    (
      text: string,
      role: Message["role"],
      type: Message["type"] = "message",
    ): string => {
      const id = crypto.randomUUID();
      dispatch({
        type: "ADD_MESSAGE",
        message: { id, text, role, type },
        maxMessages: maxMessagesRef.current,
      });
      return id;
    },
    [],
  );

  const removeMessage = useCallback((id: string) => {
    dispatch({ type: "REMOVE_MESSAGE", id });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: "CLEAR_MESSAGES" });
  }, []);

  const setPhase = useCallback((phase: Phase, turnPhase?: TurnPhase) => {
    phaseRef.current = phase;
    dispatch({ type: "SET_PHASE", phase, turnPhase });
  }, []);

  const setError = useCallback((error: VoiceAgentError | null) => {
    dispatch({ type: "SET_ERROR", error });
    if (error) onErrorRef.current?.(error);
  }, []);

  // ── session cleanup ───────────────────────────────────────────────

  const cleanup = useCallback(() => {
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
    speakingRef.current = false;
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  // ── mic capture ───────────────────────────────────────────────────

  async function startCapture(sampleRate: number): Promise<void> {
    if (!socketRef.current) return;

    micStreamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (!socketRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      return;
    }

    captureCtxRef.current = new AudioContext({ sampleRate });
    const source = captureCtxRef.current.createMediaStreamSource(
      micStreamRef.current,
    );

    await captureCtxRef.current.audioWorklet.addModule(getPCMWorkletUrl());

    if (!socketRef.current) return;

    captureNodeRef.current = new AudioWorkletNode(
      captureCtxRef.current,
      "pcm-processor",
    );
    captureNodeRef.current.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(e.data);
      }
    };
    source.connect(captureNodeRef.current);
    captureNodeRef.current.connect(captureCtxRef.current.destination);
  }

  // ── stop ──────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (phaseRef.current === "idle") return;
    cleanup();
    setPhase("idle", "listening");
    onDisconnectRef.current?.();
  }, [cleanup, setPhase]);

  // ── start ─────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "idle") return;

    setPhase("connecting");
    dispatch({ type: "SET_ERROR", error: null });
    thinkingIdRef.current = null;

    // ── handle server messages ────────────────────────────────────
    function handleMessage(msg: Record<string, unknown>): void {
      switch (msg.type) {
        case "ready": {
          const sampleRate = msg.sample_rate as number;
          if (phaseRef.current !== "connecting") break;
          startCapture(sampleRate)
            .then(() => {
              if (phaseRef.current !== "connecting") return;
              setPhase("active", "listening");
              onConnectRef.current?.();
            })
            .catch((err) => {
              if (phaseRef.current === "idle") return;
              const isMicDenied =
                err instanceof DOMException &&
                (err.name === "NotAllowedError" ||
                  err.name === "PermissionDeniedError");
              setError({
                code: isMicDenied ? "mic_denied" : "connection_failed",
                message: isMicDenied
                  ? "Microphone access denied"
                  : "Failed to start voice session",
                cause: err,
              });
              stopRecording();
            });
          break;
        }
        case "turn":
          onTurnStartRef.current?.(msg.text as string);
          addMessage(msg.text as string, "user");
          break;
        case "thinking":
          thinkingIdRef.current = addMessage("", "assistant", "thinking");
          setPhase("active", "processing");
          break;
        case "chat":
          if (thinkingIdRef.current) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          if (msg.text) addMessage(msg.text as string, "assistant");
          onTurnEndRef.current?.(msg.text as string);
          break;
        case "greeting":
          addMessage(msg.text as string, "assistant");
          break;
        case "tts_done":
          if (playerRef.current) {
            playerRef.current.flush();
          }
          break;
        case "error":
          if (thinkingIdRef.current) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          setError({ code: "chat_error", message: msg.message as string });
          break;
        case "cancelled":
          if (thinkingIdRef.current) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          speakingRef.current = false;
          playerRef.current?.clear();
          if (phaseRef.current === "active") setPhase("active", "listening");
          break;
      }
    }

    try {
      // 1. Create player during user gesture so AudioContext isn't suspended
      const playbackCtx = new AudioContext({ sampleRate: 24000 });
      if (playbackCtx.state === "suspended") await playbackCtx.resume();

      const player = new PCMPlayer();
      await player.init(playbackCtx);

      player.onStarted = () => {
        if (!speakingRef.current) {
          speakingRef.current = true;
          if (phaseRef.current === "active") setPhase("active", "speaking");
        }
      };
      player.onDone = () => {
        speakingRef.current = false;
        if (phaseRef.current === "active") setPhase("active", "listening");
      };
      playerRef.current = player;

      // 2. Connect WebSocket
      const wsUrl = toWsUrl(`${baseUrl}/session`);
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
            handleMessage(JSON.parse(evt.data));
          } catch {
            // ignore parse errors
          }
        }
      };

      ws.onclose = () => {
        socketRef.current = null;
        cleanup();
        if (phaseRef.current !== "idle") {
          setPhase("idle", "listening");
          onDisconnectRef.current?.();
        }
      };
    } catch (err) {
      if ((phaseRef.current as Phase) !== "connecting") return;
      setError({
        code: "connection_failed",
        message: "Failed to connect to voice session",
        cause: err,
      });
      console.error("Failed to start recording:", err);
      stopRecording();
    }
  }, [
    baseUrl,
    cleanup,
    addMessage,
    removeMessage,
    setPhase,
    setError,
    stopRecording,
  ]);

  const toggleRecording = useCallback(() => {
    if (phaseRef.current === "idle") startRecording();
    else stopRecording();
  }, [startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return {
    messages: state.messages,
    error: state.error,
    phase: state.phase,
    turnPhase: state.turnPhase,
    toggleRecording,
    clearMessages,
  };
}
