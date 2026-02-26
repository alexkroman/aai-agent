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
 * Mutable internal state lives in the closure (not in zustand) so it
 * never triggers React re-renders.  External deps (hooks from
 * useSTTSocket / useTTSPlayback and config props) are injected via
 * _setDeps and kept current on every render.
 */
export function createVoiceStore() {
  // Mutable internal state — never triggers re-renders
  let busy = false;
  let turnText = "";
  let chatAbort: AbortController | null = null;
  let chatTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let recording = false;
  let debouncedSend: DebouncedFn | null = null;
  let deps: VoiceDeps | null = null;

  /** Safely access deps — throws a clear error instead of null dereference. */
  function getDeps(): VoiceDeps {
    if (!deps)
      throw new Error(
        "Voice store used before dependencies were injected via _setDeps",
      );
    return deps;
  }

  return create<VoiceStoreState>((set, get) => {
    const setStatus = (
      text: string,
      cls: VoiceStoreState["statusClass"] = "",
    ) => set({ statusText: text, statusClass: cls });

    const setError = (error: VoiceAgentError | null) => {
      set({ error });
      if (error) getDeps().onError?.(error);
    };

    const streamHandlers = (
      onReply: (msg: ReplyMessage) => void,
    ): TTSStreamHandlers => ({
      onReply,
      onSpeaking: () => setStatus("Speaking...", "speaking"),
      onDone: () => {
        if (recording) setStatus("Listening...", "listening");
      },
    });

    return {
      // ── reactive state ─────────────────────────────────────────────────
      messages: [],
      statusText: "Click microphone to start",
      statusClass: "",
      isRecording: false,
      error: null,

      // ── dep injection (called every render) ────────────────────────────
      _setDeps: (d) => {
        deps = d;
      },
      _initDebounce: (ms) => {
        debouncedSend?.cancel();
        debouncedSend = debounce(() => get().sendTurnToAgent(), ms);
      },

      // ── state helpers ──────────────────────────────────────────────────
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

      // ── orchestration actions ──────────────────────────────────────────
      bargeIn: () => {
        const d = getDeps();
        if (chatAbort) chatAbort.abort();
        clearTimeout(chatTimeoutId);
        d.stopPlayback();
        d.sendClear();
        d.onBargeIn?.();
        fetch(`${d.baseUrl}/cancel`, { method: "POST" }).catch(() => {});
      },

      sendTurnToAgent: async () => {
        const d = getDeps();
        const { addMessage, removeMessage, bargeIn } = get();
        const text = turnText.trim();
        turnText = "";
        if (!text) return;

        if (busy) bargeIn();
        busy = true;

        d.onTurnStart?.(text);
        addMessage(text, "user");

        const thinkingId = addMessage("", "assistant", "thinking");
        setStatus("Thinking...", "processing");
        chatAbort = new AbortController();
        chatTimeoutId = setTimeout(() => chatAbort?.abort(), d.fetchTimeout);

        try {
          const resp = await fetch(`${d.baseUrl}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text }),
            signal: chatAbort.signal,
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
          clearTimeout(chatTimeoutId);
          busy = false;
          chatAbort = null;
          if (recording && !d.speakingRef.current) {
            setStatus("Listening...", "listening");
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
          setStatus("Listening...", "listening");
        }

        if (msg.turn_is_formatted) {
          turnText = text;
          debouncedSend?.();
        }
      },

      greet: async () => {
        const d = getDeps();
        const { addMessage } = get();
        try {
          const resp = await fetch(`${d.baseUrl}/greet`, {
            method: "POST",
            signal: AbortSignal.timeout(d.fetchTimeout),
          });
          if (resp.status === 204) return;
          await d.readStream(
            resp,
            streamHandlers((msg) => {
              if (msg.text) addMessage(msg.text, "assistant");
            }),
          );
        } catch (err) {
          console.error("Greeting error:", err);
        }
      },

      reconnectSTT: async () => {
        const d = getDeps();
        if (!recording || !d.reconnect) return;

        for (let attempt = 1; attempt <= d.maxReconnectAttempts; attempt++) {
          try {
            await new Promise((r) =>
              setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)),
            );
            if (!recording) return; // user stopped during backoff

            const resp = await fetch(`${d.baseUrl}/tokens`, {
              signal: AbortSignal.timeout(d.fetchTimeout),
            });
            const { wss_url }: TokensResponse = await resp.json();

            await d.sttConnect(wss_url, {
              onMessage: get().handleAAIMessage,
              onUnexpectedClose: () => {
                if (recording) get().reconnectSTT();
              },
            });

            setStatus("Listening...", "listening");
            return; // success
          } catch (err) {
            console.warn(`STT reconnect attempt ${attempt} failed:`, err);
          }
        }

        // all attempts exhausted
        const error: VoiceAgentError = {
          code: "reconnect_failed",
          message: "Failed to reconnect to speech recognition",
        };
        setError(error);
        get().stopRecording();
      },

      stopRecording: () => {
        const d = getDeps();
        debouncedSend?.cancel();
        turnText = "";
        if (chatAbort) {
          chatAbort.abort();
          chatAbort = null;
        }
        clearTimeout(chatTimeoutId);

        get().bargeIn();
        d.sttDisconnect();

        recording = false;
        busy = false;
        set({ isRecording: false });
        setStatus("Click microphone to start");

        d.onDisconnect?.();
        fetch(`${d.baseUrl}/reset`, { method: "POST" }).catch(() => {});
      },

      startRecording: async () => {
        const d = getDeps();
        const { handleAAIMessage, greet, stopRecording, reconnectSTT } = get();
        try {
          setStatus("Connecting...");
          setError(null);

          const resp = await fetch(`${d.baseUrl}/tokens`, {
            signal: AbortSignal.timeout(d.fetchTimeout),
          });
          const { wss_url, sample_rate }: TokensResponse = await resp.json();

          await d.sttConnect(wss_url, {
            onMessage: handleAAIMessage,
            onUnexpectedClose: () => {
              if (recording) {
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

          await d.startCapture(sample_rate);

          recording = true;
          turnText = "";
          set({ isRecording: true });
          setStatus("Listening...", "listening");

          d.onConnect?.();
          if (d.autoGreet) greet();
        } catch (err) {
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
          setStatus(error.message);
          stopRecording();
        }
      },

      toggleRecording: () => {
        if (recording) get().stopRecording();
        else get().startRecording();
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

  return useStore(
    useShallow((s: VoiceStoreState) => ({
      messages: s.messages,
      error: s.error,
      statusClass: s.statusClass,
      isRecording: s.isRecording,
      toggleRecording: s.toggleRecording,
      sendMessage: s.sendMessage,
      clearMessages: s.clearMessages,
    })),
  );
}
