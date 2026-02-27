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
  const configRef = useRef(opts.config);
  const toolsRef = useRef(opts.tools);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  // Update refs on every render so useEffect always has latest values
  configRef.current = opts.config;
  toolsRef.current = opts.tools;

  useEffect(() => {
    const session = new VoiceSession(
      {
        apiKey: opts.apiKey,
        platformUrl: opts.platformUrl,
        config: configRef.current,
        tools: toolsRef.current,
      },
      {
        onStateChange(newState: AgentState) {
          setState(newState);
        },
        onMessage(msg: Message) {
          setMessages((m: Message[]) => [...m, msg]);
        },
        onTranscript(text: string) {
          setTranscript(text);
        },
        onError(message: string) {
          setError(message);
        },
      }
    );

    sessionRef.current = session;
    try {
      session.connect();
    } catch (err: any) {
      setError(err.message ?? "Connection failed");
      setState("error");
    }

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
    setError("");
  }, []);

  return { state, messages, transcript, error, cancel, reset };
}
