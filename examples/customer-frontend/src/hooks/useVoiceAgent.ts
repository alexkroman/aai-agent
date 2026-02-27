// hooks/useVoiceAgent.ts — Voice agent hook with built-in audio handling.
// Generated once. Do not edit.
import { useEffect, useRef, useState, useCallback } from "react";
import { startMicCapture, createAudioPlayer } from "../lib/audio";

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking";

export interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
}

export function useVoiceAgent(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<AgentState>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => setState("ready");

    ws.onmessage = (event) => {
      // Binary frame = TTS audio
      if (event.data instanceof ArrayBuffer) {
        playerRef.current?.enqueue(event.data);
        return;
      }

      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "ready": {
          const player = createAudioPlayer(msg.ttsSampleRate ?? 24000);
          playerRef.current = player;
          startMicCapture(ws, msg.sampleRate ?? 16000).then((cleanup) => {
            micCleanupRef.current = cleanup;
          });
          setState("listening");
          break;
        }
        case "greeting":
          setMessages((m) => [...m, { role: "assistant", text: msg.text }]);
          setState("speaking");
          break;
        case "transcript":
          setTranscript(msg.text);
          setState((prev) => (prev !== "thinking" ? "listening" : prev));
          break;
        case "turn":
          setMessages((m) => [...m, { role: "user", text: msg.text }]);
          setTranscript("");
          break;
        case "thinking":
          setState("thinking");
          break;
        case "chat":
          setMessages((m) => [
            ...m,
            { role: "assistant", text: msg.text, steps: msg.steps },
          ]);
          setState("speaking");
          break;
        case "tts_done":
          setState("listening");
          break;
        case "cancelled":
          playerRef.current?.flush();
          setState("listening");
          break;
        case "error":
          console.error("Agent error:", msg.message);
          break;
      }
    };

    ws.onclose = () => setState("connecting");

    return () => {
      micCleanupRef.current?.();
      playerRef.current?.close();
      ws.close();
    };
  }, [url]);

  const cancel = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
    playerRef.current?.flush();
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "reset" }));
    playerRef.current?.flush();
    setMessages([]);
    setTranscript("");
  }, []);

  return { state, messages, transcript, cancel, reset };
}
