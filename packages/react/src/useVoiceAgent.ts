import { useRef, useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { debounce } from "./debounce";
import { useSTTSocket } from "./useSTTSocket";
import { useTTSPlayback } from "./useTTSPlayback";
import type {
  MessageId,
  VoiceStoreState,
  VoiceDeps,
  VoiceAgentOptions,
  VoiceAgentResult,
  VoiceAgentError,
  AAIMessage,
  TokensResponse,
  ReplyMessage,
  TTSStreamHandlers,
} from "./types";
import type { DebouncedFn } from "./debounce";

const DEFAULT_DEBOUNCE_MS = 1500;
const DEFAULT_BARGE_IN_MIN_CHARS = 20;
const DEFAULT_FETCH_TIMEOUT = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Creates a zustand store that owns all voice-agent orchestration.
 *
 * Phase and turnPhase live in zustand as the single source of truth.
 * UI concerns like CSS classes are derived from these phases by consumers.
 *
 * Cancellation is handled by two AbortControllers:
 *   - sessionAbort: created when connecting, aborted when returning to
 *     idle.  Every fetch in the session uses this signal, so stopping
 *     the session kills everything — no stale-finally races.
 *   - turnAbort: created per greet/chat turn, aborted on barge-in.
 *     Lets us cancel one request without nuking the whole session.
 */
export function createVoiceStore() {
  // Resources — not state, just handles tied to phase transitions
  let sessionAbort: AbortController | null = null;
  let turnAbort: AbortController | null = null;
  let turnText = "";
  let debouncedSend: DebouncedFn | null = null;
  let deps: VoiceDeps | null = null;

  function getDeps(): VoiceDeps {
    if (!deps)
      throw new Error(
        "Voice store used before dependencies were injected via _setDeps",
      );
    return deps;
  }

  /** Create a turn-scoped AbortController chained to the session. */
  function newTurnAbort(): AbortController {
    const ac = new AbortController();
    // If session is aborted, also abort the turn
    sessionAbort?.signal.addEventListener("abort", () => ac.abort(), {
      signal: ac.signal,
    });
    return ac;
  }

  return create<VoiceStoreState>((set, get) => {
    const setError = (error: VoiceAgentError | null) => {
      set({ error });
      if (error) getDeps().onError?.(error);
    };

    const streamHandlers = (
      onReply: (msg: ReplyMessage) => void,
    ): TTSStreamHandlers => ({
      onReply,
      onSpeaking: () => get().setPhase("active", "speaking"),
      onDone: () => {
        if (get().phase === "active") get().setPhase("active", "listening");
      },
    });

    return {
      // ── state ────────────────────────────────────────────────────────────
      phase: "idle",
      turnPhase: "listening",
      messages: [],
      error: null,

      // ── dep injection (called every render) ──────────────────────────────
      _setDeps: (d) => {
        deps = d;
      },
      _initDebounce: (ms) => {
        debouncedSend?.cancel();
        debouncedSend = debounce(() => get().sendTurnToAgent(), ms);
      },

      // ── phase transitions ────────────────────────────────────────────────
      setPhase: (p, tp) => {
        set(tp ? { phase: p, turnPhase: tp } : { phase: p });
      },

      // ── state helpers ────────────────────────────────────────────────────
      addMessage: (text, role, type = "message") => {
        const id = crypto.randomUUID() as MessageId;
        set((s) => {
          const messages = [...s.messages, { id, text, role, type }];
          const max = deps?.maxMessages ?? 0;
          if (max > 0 && messages.length > max) {
            return { messages: messages.slice(-max) };
          }
          return { messages };
        });
        return id;
      },
      removeMessage: (id) =>
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
      clearMessages: () => set({ messages: [] }),

      // ── orchestration actions ────────────────────────────────────────────
      bargeIn: () => {
        const d = getDeps();
        if (turnAbort) {
          turnAbort.abort();
          turnAbort = null;
        }
        d.stopPlayback();
        d.sendClear();
        d.onBargeIn?.();
        fetch(`${d.baseUrl}/cancel`, { method: "POST" }).catch(() => {});
      },

      sendTurnToAgent: async () => {
        const d = getDeps();
        const { addMessage, removeMessage, bargeIn, setPhase } = get();
        const text = turnText.trim();
        turnText = "";
        if (!text) return;

        if (turnAbort) bargeIn();

        d.onTurnStart?.(text);
        addMessage(text, "user");

        const thinkingId = addMessage("", "assistant", "thinking");
        setPhase("active", "processing");

        const abort = newTurnAbort();
        turnAbort = abort;

        try {
          const resp = await fetch(`${d.baseUrl}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text }),
            signal: abort.signal,
          });

          let replyText = "";
          await d.readStream(
            resp,
            streamHandlers((msg) => {
              removeMessage(thinkingId);
              if (msg.text) {
                replyText = msg.text;
                addMessage(msg.text, "assistant");
              }
            }),
          );
          d.onTurnEnd?.(replyText);
        } catch (err) {
          removeMessage(thinkingId);
          if (err instanceof Error && err.name !== "AbortError") {
            const error: VoiceAgentError = {
              code: "chat_error",
              message: "Failed to get response from agent",
              cause: err,
            };
            setError(error);
            addMessage("Sorry, something went wrong.", "assistant");
          }
        } finally {
          if (turnAbort === abort) turnAbort = null;
          if (get().phase === "active" && !d.speakingRef.current) {
            setPhase("active", "listening");
          }
        }
      },

      sendMessage: async (text: string) => {
        debouncedSend?.cancel();
        turnText = text;
        await get().sendTurnToAgent();
      },

      handleAAIMessage: (msg: AAIMessage) => {
        if (msg.type !== "Turn") return;
        const text = msg.transcript?.trim();
        if (!text) return;

        const d = getDeps();
        if (
          d.enableBargeIn &&
          d.speakingRef.current &&
          text.length >= d.bargeInMinChars
        ) {
          get().bargeIn();
          get().setPhase("active", "listening");
        }

        if (msg.turn_is_formatted) {
          turnText = text;
          debouncedSend?.();
        }
      },

      greet: async () => {
        const d = getDeps();
        const { addMessage, bargeIn } = get();

        if (turnAbort) bargeIn();
        const abort = newTurnAbort();
        turnAbort = abort;

        try {
          const resp = await fetch(`${d.baseUrl}/greet`, {
            method: "POST",
            signal: abort.signal,
          });
          if (get().phase !== "active") return;
          if (resp.status === 204) return;
          await d.readStream(
            resp,
            streamHandlers((msg) => {
              if (msg.text) addMessage(msg.text, "assistant");
            }),
          );
        } catch (err) {
          if (err instanceof Error && err.name !== "AbortError") {
            console.error("Greeting error:", err);
          }
        } finally {
          if (turnAbort === abort) turnAbort = null;
        }
      },

      reconnectSTT: async () => {
        const d = getDeps();
        if (get().phase !== "active" || !d.reconnect) return;

        for (let attempt = 1; attempt <= d.maxReconnectAttempts; attempt++) {
          try {
            await new Promise((r) =>
              setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)),
            );
            if (get().phase !== "active") return;

            const resp = await fetch(`${d.baseUrl}/tokens`, {
              signal: sessionAbort?.signal,
            });
            const { wss_url }: TokensResponse = await resp.json();

            await d.sttConnect(wss_url, {
              onMessage: get().handleAAIMessage,
              onUnexpectedClose: () => {
                if (get().phase === "active") get().reconnectSTT();
              },
            });

            get().setPhase("active", "listening");
            return;
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return;
            console.warn(`STT reconnect attempt ${attempt} failed:`, err);
          }
        }

        const error: VoiceAgentError = {
          code: "reconnect_failed",
          message: "Failed to reconnect to speech recognition",
        };
        setError(error);
        get().stopRecording();
      },

      stopRecording: () => {
        if (get().phase === "idle") return;
        const d = getDeps();

        // Abort the session — kills ALL in-flight fetches (connect, greet, chat)
        if (sessionAbort) {
          sessionAbort.abort();
          sessionAbort = null;
        }
        turnAbort = null;

        debouncedSend?.cancel();
        d.stopPlayback();
        d.sendClear();
        d.sttDisconnect();

        get().setPhase("idle", "listening");

        d.onDisconnect?.();
        fetch(`${d.baseUrl}/reset`, { method: "POST" }).catch(() => {});
      },

      startRecording: async () => {
        if (get().phase !== "idle") return;

        const d = getDeps();
        const {
          handleAAIMessage,
          greet,
          stopRecording,
          reconnectSTT,
          setPhase,
        } = get();

        // Create session-scoped abort — stopRecording kills it
        sessionAbort = new AbortController();
        const signal = sessionAbort.signal;

        setPhase("connecting");
        setError(null);

        try {
          const resp = await fetch(`${d.baseUrl}/tokens`, { signal });
          if (get().phase !== "connecting") return;

          const { wss_url, sample_rate }: TokensResponse = await resp.json();

          await d.sttConnect(wss_url, {
            onMessage: handleAAIMessage,
            onUnexpectedClose: () => {
              if (get().phase === "active") {
                if (d.reconnect) {
                  reconnectSTT();
                } else {
                  const error: VoiceAgentError = {
                    code: "websocket_closed",
                    message:
                      "Speech recognition connection closed unexpectedly",
                  };
                  setError(error);
                }
              }
            },
          });
          if (get().phase !== "connecting") return;

          await d.startCapture(sample_rate);
          if (get().phase !== "connecting") return;

          turnText = "";
          setPhase("active", "listening");

          d.onConnect?.();
          if (d.autoGreet) greet();
        } catch (err) {
          if (get().phase !== "connecting") return;

          const isMicDenied =
            err instanceof DOMException &&
            (err.name === "NotAllowedError" ||
              err.name === "PermissionDeniedError");

          const error: VoiceAgentError = {
            code: isMicDenied ? "mic_denied" : "connection_failed",
            message: isMicDenied
              ? "Microphone access denied"
              : "Failed to start voice session",
            cause: err,
          };
          setError(error);
          console.error("Failed to start recording:", err);
          stopRecording();
        }
      },

      toggleRecording: () => {
        if (get().phase === "idle") get().startRecording();
        else get().stopRecording();
      },
    };
  });
}

/**
 * React hook that manages a full voice-agent session: microphone capture,
 * real-time STT via AssemblyAI WebSocket, agent chat, and TTS playback.
 */
export function useVoiceAgent({
  baseUrl = "",
  debounceMs = DEFAULT_DEBOUNCE_MS,
  autoGreet = true,
  bargeInMinChars = DEFAULT_BARGE_IN_MIN_CHARS,
  enableBargeIn = true,
  maxMessages = 0,
  reconnect = true,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  fetchTimeout = DEFAULT_FETCH_TIMEOUT,
  onError,
  onConnect,
  onDisconnect,
  onBargeIn,
  onTurnStart,
  onTurnEnd,
}: VoiceAgentOptions = {}): VoiceAgentResult {
  const useStoreRef = useRef<ReturnType<typeof createVoiceStore> | null>(null);
  if (!useStoreRef.current) useStoreRef.current = createVoiceStore();
  const useStore = useStoreRef.current;

  const {
    connect: sttConnect,
    startCapture,
    disconnect: sttDisconnect,
    sendClear,
  } = useSTTSocket();
  const { readStream, stop: stopPlayback, speakingRef } = useTTSPlayback();

  // Keep external deps current every render
  useStore.getState()._setDeps({
    baseUrl,
    autoGreet,
    bargeInMinChars,
    enableBargeIn,
    maxMessages,
    reconnect,
    maxReconnectAttempts,
    fetchTimeout,
    sttConnect,
    startCapture,
    sttDisconnect,
    sendClear,
    readStream,
    stopPlayback,
    speakingRef,
    onError,
    onConnect,
    onDisconnect,
    onBargeIn,
    onTurnStart,
    onTurnEnd,
  });

  useEffect(() => {
    useStore.getState()._initDebounce(debounceMs);
  }, [useStore, debounceMs]);

  // Actions are stable references — select them once, not through useShallow
  const { toggleRecording, sendMessage, clearMessages } = useStore.getState();

  // Only reactive state goes through the selector
  const { messages, error, phase, turnPhase } = useStore(
    useShallow((s: VoiceStoreState) => ({
      messages: s.messages,
      error: s.error,
      phase: s.phase,
      turnPhase: s.turnPhase,
    })),
  );

  return {
    messages,
    error,
    phase,
    turnPhase,
    toggleRecording,
    sendMessage,
    clearMessages,
  };
}
