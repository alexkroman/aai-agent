import { useCallback, useReducer, useRef } from "react";
import { useSessionSocket } from "./useSessionSocket";
import type { SessionHandlers } from "./useSessionSocket";
import type {
  VoiceAgentOptions,
  VoiceAgentResult,
  VoiceAgentError,
  Message,
  MessageId,
  MessageRole,
  MessageType,
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
  | { type: "REMOVE_MESSAGE"; id: MessageId }
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

// ── Helper ────────────────────────────────────────────────────────────

function newMessageId(): MessageId {
  return crypto.randomUUID() as MessageId;
}

// ── Hook ──────────────────────────────────────────────────────────────

/**
 * React hook that manages a full voice-agent session through a single
 * multiplexed WebSocket. The server handles STT, turn detection, LLM,
 * barge-in, and TTS. The browser is a thin audio I/O client.
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

  const {
    connect: sessionConnect,
    startCapture,
    initPlayer,
    disconnect: sessionDisconnect,
    generationRef,
  } = useSessionSocket();

  // ── message helpers ────────────────────────────────────────────────
  const addMessage = useCallback(
    (
      text: string,
      role: MessageRole,
      type: MessageType = "message",
    ): MessageId => {
      const id = newMessageId();
      dispatch({
        type: "ADD_MESSAGE",
        message: { id, text, role, type },
        maxMessages: maxMessagesRef.current,
      });
      return id;
    },
    [],
  );

  const removeMessage = useCallback((id: MessageId) => {
    dispatch({ type: "REMOVE_MESSAGE", id });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: "CLEAR_MESSAGES" });
  }, []);

  // ── phase helpers ──────────────────────────────────────────────────
  const setPhase = useCallback((phase: Phase, turnPhase?: TurnPhase) => {
    phaseRef.current = phase;
    dispatch({ type: "SET_PHASE", phase, turnPhase });
  }, []);

  const setError = useCallback((error: VoiceAgentError | null) => {
    dispatch({ type: "SET_ERROR", error });
    if (error) onErrorRef.current?.(error);
  }, []);

  // ── stop ───────────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (phaseRef.current === "idle") return;
    sessionDisconnect();
    setPhase("idle", "listening");
    onDisconnectRef.current?.();
  }, [sessionDisconnect, setPhase]);

  // ── start ──────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "idle") return;

    setPhase("connecting");
    dispatch({ type: "SET_ERROR", error: null });

    let thinkingId: MessageId | null = null;

    // Capture the generation at connect time so async init steps
    // (initPlayer, startCapture) can detect if disconnect was called.
    const gen = generationRef.current;

    const handlers: SessionHandlers = {
      onReady: async (sampleRate, ttsSampleRate) => {
        if (phaseRef.current !== "connecting") return;
        try {
          await initPlayer(ttsSampleRate, gen);
          await startCapture(sampleRate, gen);
          // Check generation — if disconnect ran during the awaits above,
          // the generation will have changed and we should bail out.
          if (gen !== generationRef.current) return;
          if (phaseRef.current !== "connecting") return;
          setPhase("active", "listening");
          onConnectRef.current?.();
        } catch (err) {
          // If session was torn down, don't report errors
          if (gen !== generationRef.current) return;

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
        }
      },
      onTurn: (text) => {
        onTurnStartRef.current?.(text);
        addMessage(text, "user");
      },
      onThinking: () => {
        thinkingId = addMessage("", "assistant", "thinking");
        setPhase("active", "processing");
      },
      onChat: (text) => {
        if (thinkingId) {
          removeMessage(thinkingId);
          thinkingId = null;
        }
        if (text) {
          addMessage(text, "assistant");
        }
        onTurnEndRef.current?.(text);
      },
      onGreeting: (text) => {
        addMessage(text, "assistant");
      },
      onTTSDone: () => {
        if (phaseRef.current === "active") {
          setPhase("active", "listening");
        }
      },
      onSpeaking: () => {
        if (phaseRef.current === "active") {
          setPhase("active", "speaking");
        }
      },
      onError: (message) => {
        if (thinkingId) {
          removeMessage(thinkingId);
          thinkingId = null;
        }
        setError({ code: "chat_error", message });
      },
      onCancelled: () => {
        if (thinkingId) {
          removeMessage(thinkingId);
          thinkingId = null;
        }
        if (phaseRef.current === "active") {
          setPhase("active", "listening");
        }
      },
      onClose: () => {
        // Server closed the WebSocket — reset to idle
        if (phaseRef.current !== "idle") {
          setPhase("idle", "listening");
          onDisconnectRef.current?.();
        }
      },
    };

    try {
      const sessionUrl = `${baseUrl}/session`;
      await sessionConnect(sessionUrl, handlers);
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
    sessionConnect,
    startCapture,
    initPlayer,
    generationRef,
    stopRecording,
    addMessage,
    removeMessage,
    setPhase,
    setError,
  ]);

  const toggleRecording = useCallback(() => {
    if (phaseRef.current === "idle") startRecording();
    else stopRecording();
  }, [startRecording, stopRecording]);

  return {
    messages: state.messages,
    error: state.error,
    phase: state.phase,
    turnPhase: state.turnPhase,
    toggleRecording,
    clearMessages,
  };
}
