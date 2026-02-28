// useVoiceSession.ts — Bridges VoiceSession events into Preact state.

import { useCallback, useEffect, useState } from "preact/hooks";
import type { VoiceSession } from "../session.ts";
import type { AgentState, Message } from "../types.ts";

export interface VoiceSessionState {
  state: AgentState;
  messages: Message[];
  transcript: string;
  error: string;
  started: boolean;
  running: boolean;
  start: () => void;
  toggle: () => void;
  reset: () => void;
}

export function useVoiceSession(session: VoiceSession): VoiceSessionState {
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const unsubs = [
      session.on("stateChange", (s) => setState(s)),
      session.on("message", (msg) => setMessages((prev) => [...prev, msg])),
      session.on("transcript", (text) => setTranscript(text)),
      session.on("error", (err) => setError(err.message)),
      session.on("reset", () => {
        setMessages([]);
        setTranscript("");
        setError("");
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [session]);

  const start = useCallback(() => {
    setStarted(true);
    setRunning(true);
    session.connect();
  }, [session]);

  const toggle = useCallback(() => {
    setRunning((prev) => {
      if (prev) {
        session.disconnect();
      } else {
        session.connect();
      }
      return !prev;
    });
  }, [session]);

  const reset = useCallback(() => {
    session.reset();
  }, [session]);

  return {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
    reset,
  };
}
