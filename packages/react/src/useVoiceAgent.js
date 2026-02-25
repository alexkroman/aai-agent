import { useState, useRef, useCallback, useEffect } from "react";
import { getPCMWorkletUrl } from "./pcm-worklet";

const DEFAULT_DEBOUNCE_MS = 1500;

let nextId = 0;

/**
 * React hook that manages a full voice-agent session: microphone capture,
 * real-time STT via AssemblyAI WebSocket, agent chat, and TTS playback.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl=""]       API base URL (e.g. "http://localhost:8000")
 * @param {number} [options.debounceMs=1500]  Silence debounce before sending a turn
 * @param {boolean} [options.autoGreet=true]  Play greeting when recording starts
 * @returns {{
 *   messages:        Array<{id:number, text:string, role:string, type:string, steps:string[]|null}>,
 *   liveTranscript:  string,
 *   showTranscript:  boolean,
 *   statusText:      string,
 *   statusClass:     string,
 *   isRecording:     boolean,
 *   toggleRecording: () => void,
 * }}
 */
export function useVoiceAgent({
  baseUrl = "",
  debounceMs = DEFAULT_DEBOUNCE_MS,
  autoGreet = true,
} = {}) {
  const [messages, setMessages] = useState([]);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [statusText, setStatusText] = useState("Click microphone to start");
  const [statusClass, setStatusClass] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const streamRef = useRef(null);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const turnTextRef = useRef("");
  const turnTimerRef = useRef(null);
  const currentAudioRef = useRef(null);
  const chatAbortRef = useRef(null);
  const isRecordingRef = useRef(false);

  // ── helpers ──────────────────────────────────────────────────────────────

  const setStatus = useCallback((text, cls) => {
    setStatusText(text);
    setStatusClass(cls);
  }, []);

  const addMessage = useCallback((text, role, type = "message", steps = null) => {
    const id = ++nextId;
    setMessages((prev) => [...prev, { id, text, role, type, steps }]);
    return id;
  }, []);

  const removeMessage = useCallback((id) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const bargeIn = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    speakingRef.current = false;
  }, []);

  // ── audio playback ──────────────────────────────────────────────────────

  const playAudio = useCallback(
    (base64Wav) =>
      new Promise((resolve) => {
        const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
        currentAudioRef.current = audio;
        audio.onended = () => {
          currentAudioRef.current = null;
          speakingRef.current = false;
          if (isRecordingRef.current) setStatus("Listening...", "listening");
          resolve();
        };
        audio.onerror = () => {
          currentAudioRef.current = null;
          speakingRef.current = false;
          resolve();
        };
        audio.play().catch(() => {
          speakingRef.current = false;
          resolve();
        });
      }),
    [setStatus],
  );

  // ── agent interaction ───────────────────────────────────────────────────

  const sendTurnToAgent = useCallback(async () => {
    const text = turnTextRef.current.trim();
    turnTextRef.current = "";
    if (!text) return;

    if (busyRef.current && chatAbortRef.current) chatAbortRef.current.abort();
    bargeIn();
    busyRef.current = true;

    setLiveTranscript("");
    setShowTranscript(false);
    addMessage(text, "user");

    const thinkingId = addMessage("", "", "thinking");
    setStatus("Thinking...", "processing");
    chatAbortRef.current = new AbortController();

    try {
      const resp = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: chatAbortRef.current.signal,
      });
      const data = await resp.json();
      removeMessage(thinkingId);

      if (data.steps?.length) addMessage("", "", "steps", data.steps);
      addMessage(data.reply, "assistant");

      if (data.audio) {
        speakingRef.current = true;
        setStatus("Speaking...", "speaking");
        await playAudio(data.audio);
      }
    } catch (err) {
      removeMessage(thinkingId);
      if (err.name === "AbortError") {
        addMessage("(interrupted)", "assistant");
      } else {
        console.error("Chat error:", err);
        addMessage("Sorry, something went wrong.", "assistant");
      }
    } finally {
      busyRef.current = false;
      chatAbortRef.current = null;
      if (isRecordingRef.current && !speakingRef.current) {
        setStatus("Listening...", "listening");
      }
    }
  }, [baseUrl, addMessage, removeMessage, bargeIn, playAudio, setStatus]);

  // ── AssemblyAI WebSocket ────────────────────────────────────────────────

  const handleAAIMessage = useCallback(
    (msg) => {
      if (msg.type !== "Turn") return;
      const text = msg.transcript?.trim();
      if (!text) return;

      if (speakingRef.current) {
        bargeIn();
        setStatus("Listening...", "listening");
      }

      setLiveTranscript(text);
      setShowTranscript(true);

      if (msg.turn_is_formatted) {
        turnTextRef.current = text;
        clearTimeout(turnTimerRef.current);
        turnTimerRef.current = setTimeout(() => sendTurnToAgent(), debounceMs);
      }
    },
    [debounceMs, bargeIn, setStatus, sendTurnToAgent],
  );

  const connectSocket = useCallback(
    (url) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => resolve(ws);
        ws.onerror = (e) => reject(e);
        ws.onmessage = (evt) => {
          if (typeof evt.data === "string") {
            handleAAIMessage(JSON.parse(evt.data));
          }
        };
        ws.onclose = () => {
          if (isRecordingRef.current) console.warn("WebSocket closed unexpectedly");
        };
      }),
    [handleAAIMessage],
  );

  // ── greeting ────────────────────────────────────────────────────────────

  const greet = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/greet`, { method: "POST" });
      const data = await resp.json();
      if (data.reply) addMessage(data.reply, "assistant");
      if (data.audio) {
        speakingRef.current = true;
        setStatus("Speaking...", "speaking");
        await playAudio(data.audio);
      }
    } catch (err) {
      console.error("Greeting error:", err);
    }
  }, [baseUrl, addMessage, playAudio, setStatus]);

  // ── recording controls ──────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    clearTimeout(turnTimerRef.current);
    turnTimerRef.current = null;
    turnTextRef.current = "";

    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }

    bargeIn();

    if (socketRef.current) {
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

    isRecordingRef.current = false;
    busyRef.current = false;
    speakingRef.current = false;
    setIsRecording(false);
    setLiveTranscript("");
    setShowTranscript(false);
    setStatus("Click microphone to start", "");
  }, [bargeIn, setStatus]);

  const startRecording = useCallback(async () => {
    try {
      setStatus("Connecting...", "");

      const resp = await fetch(`${baseUrl}/tokens`);
      const { wss_url, sample_rate } = await resp.json();

      socketRef.current = await connectSocket(wss_url);

      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: sample_rate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      audioContextRef.current = new AudioContext({ sampleRate: sample_rate });
      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);

      // Load the PCM worklet from an inline Blob URL — no static file needed.
      await audioContextRef.current.audioWorklet.addModule(getPCMWorkletUrl());
      workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, "pcm-processor");
      workletNodeRef.current.port.onmessage = (e) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(e.data);
        }
      };
      source.connect(workletNodeRef.current);
      workletNodeRef.current.connect(audioContextRef.current.destination);

      isRecordingRef.current = true;
      setIsRecording(true);
      setStatus("Listening...", "listening");
      turnTextRef.current = "";

      if (autoGreet) greet();
    } catch (err) {
      console.error("Failed to start recording:", err);
      setStatus("Microphone access denied", "");
      stopRecording();
    }
  }, [baseUrl, autoGreet, connectSocket, greet, stopRecording, setStatus]);

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  // ── cleanup on unmount ──────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        if (socketRef.current) socketRef.current.close();
        if (workletNodeRef.current) workletNodeRef.current.disconnect();
        if (audioContextRef.current) audioContextRef.current.close();
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        if (currentAudioRef.current) currentAudioRef.current.pause();
      }
    };
  }, []);

  return {
    messages,
    liveTranscript,
    showTranscript,
    statusText,
    statusClass,
    isRecording,
    toggleRecording,
  };
}
