// react.ts — React hook: useVoiceAgent().
// Bundled as react.js, served by the platform.
// Uses React as a peer dependency (customer provides React).

import {
  VoiceSession,
  type AgentOptions,
  type AgentState,
  type Message,
  type ToolDef,
  type ToolContext,
} from "./core.js";

// Import React from the customer's bundle (peer dependency)
// @ts-expect-error — React is provided by the customer, not bundled
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

export type { AgentState, Message, ToolDef, ToolContext };

export interface VoiceAgentOptions {
  apiKey: string;
  platformUrl?: string;
  instructions?: string;
  greeting?: string;
  voice?: string;
  tools?: Record<string, ToolDef>;
}

export function useVoiceAgent(opts: VoiceAgentOptions) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const toolsRef = useRef(opts.tools);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  // Memoize config/tools so changes trigger reconnection
  const configKey = useMemo(
    () => JSON.stringify({ instructions: opts.instructions, greeting: opts.greeting, voice: opts.voice }),
    [opts.instructions, opts.greeting, opts.voice]
  );
  const toolNames = useMemo(
    () => (opts.tools ? Object.keys(opts.tools).sort().join(",") : ""),
    [opts.tools]
  );

  // Update ref on every render so useEffect always has latest values
  toolsRef.current = opts.tools;

  useEffect(() => {
    const session = new VoiceSession(
      {
        apiKey: opts.apiKey,
        platformUrl: opts.platformUrl,
        instructions: opts.instructions,
        greeting: opts.greeting,
        voice: opts.voice,
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
  }, [opts.apiKey, opts.platformUrl, configKey, toolNames]);

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
