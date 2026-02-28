// signals.ts — Bridges VoiceSession events into Preact signals.

import { signal } from "@preact/signals";
import type { VoiceSession } from "./session.ts";
import type { AgentState, Message } from "./types.ts";

export function createSessionSignals(session: VoiceSession) {
  const state = signal<AgentState>("connecting");
  const messages = signal<Message[]>([]);
  const transcript = signal<string>("");
  const error = signal<string>("");
  const started = signal(false);
  const running = signal(true);

  session.on("stateChange", (s) => (state.value = s));
  session.on(
    "message",
    (msg) => (messages.value = [...messages.value, msg]),
  );
  session.on("transcript", (t) => (transcript.value = t));
  session.on("error", (err) => (error.value = err.message));
  session.on("reset", () => {
    messages.value = [];
    transcript.value = "";
    error.value = "";
  });

  return {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start() {
      started.value = true;
      running.value = true;
      session.connect();
    },
    toggle() {
      if (running.value) session.disconnect();
      else session.connect();
      running.value = !running.value;
    },
    reset() {
      session.reset();
    },
  };
}

export type SessionSignals = ReturnType<typeof createSessionSignals>;
