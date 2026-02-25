import { useRef, useCallback, useEffect } from "react";
import { getPCMWorkletUrl } from "./pcm-worklet";

/**
 * Hook that manages an AssemblyAI WebSocket STT connection and microphone
 * capture via an AudioWorklet.
 *
 * @returns {{
 *   connect:      (url: string, handlers?: {onMessage?, onUnexpectedClose?}) => Promise<WebSocket>,
 *   startCapture: (sampleRate: number) => Promise<void>,
 *   disconnect:   () => void,
 *   sendClear:    () => void,
 * }}
 */
export function useSTTSocket() {
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const streamRef = useRef(null);

  /**
   * Open a WebSocket connection to AssemblyAI.
   * @param {string} url  WebSocket URL with auth token
   * @param {object} [handlers]
   * @param {(msg: object) => void} [handlers.onMessage]
   * @param {() => void} [handlers.onUnexpectedClose]
   * @returns {Promise<WebSocket>}
   */
  const connect = useCallback(
    (url, { onMessage, onUnexpectedClose } = {}) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          socketRef.current = ws;
          resolve(ws);
        };
        ws.onerror = (e) => reject(e);
        ws.onmessage = (evt) => {
          if (typeof evt.data === "string" && onMessage) {
            onMessage(JSON.parse(evt.data));
          }
        };
        ws.onclose = () => {
          if (onUnexpectedClose) onUnexpectedClose();
        };
      }),
    [],
  );

  /**
   * Start microphone capture and pipe PCM audio to the WebSocket.
   * @param {number} sampleRate  Audio sample rate (e.g. 16000)
   */
  const startCapture = useCallback(async (sampleRate) => {
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioContextRef.current = new AudioContext({ sampleRate });
    const source = audioContextRef.current.createMediaStreamSource(streamRef.current);

    await audioContextRef.current.audioWorklet.addModule(getPCMWorkletUrl());
    workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, "pcm-processor");
    workletNodeRef.current.port.onmessage = (e) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(e.data);
      }
    };
    source.connect(workletNodeRef.current);
    workletNodeRef.current.connect(audioContextRef.current.destination);
  }, []);

  /**
   * Disconnect WebSocket and release all audio resources.
   */
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.onclose = null;
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "terminate_session" }));
      }
      socketRef.current.close();
      socketRef.current = null;
    }
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

  /**
   * Send a "clear" command to discard buffered audio in AssemblyAI.
   */
  const sendClear = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ operation: "clear" }));
    }
  }, []);

  useEffect(() => disconnect, [disconnect]);

  return { connect, startCapture, disconnect, sendClear };
}
