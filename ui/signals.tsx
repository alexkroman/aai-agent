// Bridges VoiceSession events into Preact signals + context provider.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { signal } from "@preact/signals";
import type { VoiceSession } from "./session.ts";
import type { AgentState, Message } from "./types.ts";

// ── Signal bridge ───────────────────────────────────────────────

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

// ── Context provider ────────────────────────────────────────────

const Ctx = createContext<SessionSignals | null>(null);

export function SessionProvider(
  { value, children }: { value: SessionSignals; children: ComponentChildren },
) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionSignals {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession() requires <SessionProvider>");
  return ctx;
}
