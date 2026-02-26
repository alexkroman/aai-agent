import { useRef, useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useSTTSocket } from "./useSTTSocket";
import { useTTSPlayback } from "./useTTSPlayback";

function debounce(fn, ms) {
  let id;
  const debounced = () => { clearTimeout(id); id = setTimeout(fn, ms); };
  debounced.cancel = () => clearTimeout(id);
  return debounced;
}

const DEFAULT_DEBOUNCE_MS = 1500;
const DEFAULT_BARGE_IN_MIN_CHARS = 20;

/**
 * Creates a zustand store that owns all voice-agent orchestration.
 * Mutable internal state lives in the closure (not in zustand) so it
 * never triggers React re-renders.  External deps (hooks from
 * useSTTSocket / useTTSPlayback and config props) are injected via
 * _setDeps and kept current on every render.
 */
function createVoiceStore() {
  // Mutable internal state — never triggers re-renders
  let busy = false;
  let turnText = "";
  let chatAbort = null;
  let recording = false;
  let debouncedSend = null;
  let deps = null;

  return create((set, get) => {
    const setStatus = (text, cls = "") => set({ statusText: text, statusClass: cls });
    const streamHandlers = (onReply) => ({
      onReply,
      onSpeaking: () => setStatus("Speaking...", "speaking"),
      onDone: () => { if (recording) setStatus("Listening...", "listening"); },
    });

    return ({
    // ── reactive state ─────────────────────────────────────────────────
    messages: [],
    statusText: "Click microphone to start",
    statusClass: "",
    isRecording: false,

    // ── dep injection (called every render) ────────────────────────────
    _setDeps: (d) => { deps = d; },
    _initDebounce: (ms) => {
      debouncedSend?.cancel();
      debouncedSend = debounce(() => get().sendTurnToAgent(), ms);
    },

    // ── state helpers ──────────────────────────────────────────────────
    addMessage: (text, role, type = "message") => {
      const id = crypto.randomUUID();
      set((s) => ({ messages: [...s.messages, { id, text, role, type }] }));
      return id;
    },
    removeMessage: (id) =>
      set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),

    // ── orchestration actions ──────────────────────────────────────────
    bargeIn: () => {
      if (chatAbort) chatAbort.abort();
      deps.stopPlayback();
      deps.sendClear();
      fetch(`${deps.baseUrl}/cancel`, { method: "POST" }).catch(() => {});
    },

    sendTurnToAgent: async () => {
      const { addMessage, removeMessage, bargeIn } = get();
      const text = turnText.trim();
      turnText = "";
      if (!text) return;

      if (busy) bargeIn();
      busy = true;

      addMessage(text, "user");

      const thinkingId = addMessage("", "", "thinking");
      setStatus("Thinking...", "processing");
      chatAbort = new AbortController();

      try {
        const resp = await fetch(`${deps.baseUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
          signal: chatAbort.signal,
        });

        await deps.readStream(resp, streamHandlers((msg) => {
          removeMessage(thinkingId);
          if (msg.text) addMessage(msg.text, "assistant");
        }));
      } catch (err) {
        removeMessage(thinkingId);
        if (err.name !== "AbortError") {
          console.error("Chat error:", err);
          addMessage("Sorry, something went wrong.", "assistant");
        }
      } finally {
        busy = false;
        chatAbort = null;
        if (recording && !deps.speakingRef.current) {
          setStatus("Listening...", "listening");
        }
      }
    },

    handleAAIMessage: (msg) => {
      if (msg.type !== "Turn") return;
      const text = msg.transcript?.trim();
      if (!text) return;

      if (deps.speakingRef.current && text.length >= deps.bargeInMinChars) {
        get().bargeIn();
        setStatus("Listening...", "listening");
      }

      if (msg.turn_is_formatted) {
        turnText = text;
        debouncedSend?.();
      }
    },

    greet: async () => {
      const { addMessage } = get();
      try {
        const resp = await fetch(`${deps.baseUrl}/greet`, { method: "POST" });
        if (resp.status === 204) return;
        await deps.readStream(resp, streamHandlers((msg) => {
          if (msg.text) addMessage(msg.text, "assistant");
        }));
      } catch (err) {
        console.error("Greeting error:", err);
      }
    },

    stopRecording: () => {
      debouncedSend?.cancel();
      turnText = "";
      if (chatAbort) { chatAbort.abort(); chatAbort = null; }

      get().bargeIn();
      deps.sttDisconnect();

      recording = false;
      busy = false;
      set({ isRecording: false, messages: [] });
      setStatus("Click microphone to start");

      fetch(`${deps.baseUrl}/reset`, { method: "POST" }).catch(() => {});
    },

    startRecording: async () => {
      const { handleAAIMessage, greet, stopRecording } = get();
      try {
        setStatus("Connecting...");

        const resp = await fetch(`${deps.baseUrl}/tokens`);
        const { wss_url, sample_rate } = await resp.json();

        await deps.sttConnect(wss_url, {
          onMessage: handleAAIMessage,
          onUnexpectedClose: () => {
            if (recording) console.warn("WebSocket closed unexpectedly");
          },
        });

        await deps.startCapture(sample_rate);

        recording = true;
        turnText = "";
        set({ isRecording: true });
        setStatus("Listening...", "listening");

        if (deps.autoGreet) greet();
      } catch (err) {
        console.error("Failed to start recording:", err);
        setStatus("Microphone access denied");
        stopRecording();
      }
    },

    toggleRecording: () => {
      if (recording) get().stopRecording();
      else get().startRecording();
    },
  });
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
} = {}) {
  const useStoreRef = useRef(null);
  if (!useStoreRef.current) useStoreRef.current = createVoiceStore();
  const useStore = useStoreRef.current;

  const { connect: sttConnect, startCapture, disconnect: sttDisconnect, sendClear } = useSTTSocket();
  const { readStream, stop: stopPlayback, speakingRef } = useTTSPlayback();

  // Keep external deps current every render
  useStore.getState()._setDeps({
    baseUrl, autoGreet, bargeInMinChars,
    sttConnect, startCapture, sttDisconnect, sendClear,
    readStream, stopPlayback, speakingRef,
  });

  useEffect(() => {
    useStore.getState()._initDebounce(debounceMs);
  }, [useStore, debounceMs]);

  return useStore(
    useShallow((s) => ({
      messages: s.messages,
      statusText: s.statusText,
      statusClass: s.statusClass,
      isRecording: s.isRecording,
      toggleRecording: s.toggleRecording,
    })),
  );
}
