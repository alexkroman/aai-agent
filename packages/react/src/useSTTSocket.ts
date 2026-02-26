import { useRef, useCallback, useEffect } from "react";
import { getPCMWorkletUrl } from "./pcm-worklet";
import { openWebSocket, closeWebSocket } from "./ws";
import type { STTHandlers, AAIMessage } from "./types";

/**
 * Hook that manages an AssemblyAI WebSocket STT connection and microphone
 * capture via an AudioWorklet.
 */
export function useSTTSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const connect = useCallback(
    async (
      url: string,
      { onMessage, onUnexpectedClose }: STTHandlers = {},
    ) => {
      const ws = await openWebSocket(url, {
        onMessage: (evt) => {
          if (typeof evt.data === "string" && onMessage) {
            onMessage(JSON.parse(evt.data) as AAIMessage);
          }
        },
        onClose: onUnexpectedClose,
      });
      socketRef.current = ws;
      return ws;
    },
    [],
  );

  const startCapture = useCallback(async (sampleRate: number) => {
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioContextRef.current = new AudioContext({ sampleRate });
    const source = audioContextRef.current.createMediaStreamSource(
      streamRef.current,
    );

    await audioContextRef.current.audioWorklet.addModule(getPCMWorkletUrl());
    workletNodeRef.current = new AudioWorkletNode(
      audioContextRef.current,
      "pcm-processor",
    );
    workletNodeRef.current.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(e.data);
      }
    };
    source.connect(workletNodeRef.current);
    workletNodeRef.current.connect(audioContextRef.current.destination);
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "terminate_session" }));
    }
    closeWebSocket(socketRef.current);
    socketRef.current = null;
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const sendClear = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ operation: "clear" }));
    }
  }, []);

  useEffect(() => disconnect, [disconnect]);

  return { connect, startCapture, disconnect, sendClear };
}
