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
  SessionError,
  SessionErrorCode,
} from "./core.js";

// Import React from the customer's bundle (peer dependency)
// @ts-expect-error — React is provided by the customer, not bundled
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

export type { AgentState, Message, ToolDef, ToolContext };
export { SessionError, SessionErrorCode };

export interface VoiceAgentOptions {
  apiKey: string;
  platformUrl?: string;
  instructions?: string;
  greeting?: string;
  voice?: string;
  prompt?: string;
  tools?: Record<string, ToolDef>;
}

export function useVoiceAgent(opts: VoiceAgentOptions) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const toolsRef = useRef(opts.tools);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<SessionError | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Memoize config/tools so changes trigger reconnection
  const configKey = useMemo(
    () => JSON.stringify({ instructions: opts.instructions, greeting: opts.greeting, voice: opts.voice, prompt: opts.prompt }),
    [opts.instructions, opts.greeting, opts.voice, opts.prompt]
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
        prompt: opts.prompt,
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
        onError(_message: string) {
          // Typed error is handled via the event emitter below
        },
      }
    );

    sessionRef.current = session;

    session.on("error", (err) => {
      setError(err);
    });

    session.on("audioReady", () => {
      setAudioReady(true);
    });

    session.on("connected", () => {
      setIsConnected(true);
    });

    session.on("disconnected", () => {
      setIsConnected(false);
      setAudioReady(false);
    });

    session.on("reset", () => {
      setMessages([]);
      setTranscript("");
      setError(null);
    });

    try {
      session.connect();
    } catch (err: any) {
      setError(
        new SessionError(
          SessionErrorCode.CONNECTION_FAILED,
          err.message ?? "Connection failed"
        )
      );
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
  }, []);

  const connect = useCallback(() => {
    sessionRef.current?.connect({ skipGreeting: true });
  }, []);

  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
  }, []);

  return { state, messages, transcript, error, audioReady, isConnected, cancel, reset, connect, disconnect };
}
