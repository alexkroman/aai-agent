// react.ts — React hook: useVoiceAgent().
// Bundled as react.js, served by the platform.
// Uses React as a peer dependency (customer provides React).

import {
  VoiceSession,
  type AgentOptions,
  type AgentState,
  type Message,
  type ToolDef,
} from "./core.js";

// Import React from the customer's bundle (peer dependency)
// @ts-expect-error — React is provided by the customer, not bundled
import { useEffect, useRef, useState, useCallback } from "react";

export type { AgentState, Message, ToolDef };

export interface VoiceAgentOptions {
  apiKey: string;
  platformUrl?: string;
  config?: { instructions?: string; greeting?: string; voice?: string };
  tools?: Record<string, ToolDef>;
}

export function useVoiceAgent(opts: VoiceAgentOptions) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    const session = new VoiceSession(
      {
        apiKey: opts.apiKey,
        platformUrl: opts.platformUrl,
        config: opts.config,
        tools: opts.tools,
      },
      {
        onStateChange(newState: AgentState) {
          setState((prev: AgentState) => {
            // Don't overwrite "thinking" with "listening" from transcript events
            if (newState === "listening" && prev === "thinking") return prev;
            return newState;
          });
        },
        onMessage(msg: Message) {
          setMessages((m: Message[]) => [...m, msg]);
        },
        onTranscript(text: string) {
          setTranscript(text);
        },
      }
    );

    sessionRef.current = session;
    session.connect();

    return () => {
      session.disconnect();
    };
  }, [opts.apiKey, opts.platformUrl]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    sessionRef.current?.reset();
    setMessages([]);
    setTranscript("");
  }, []);

  return { state, messages, transcript, cancel, reset };
}
