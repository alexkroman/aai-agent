import { useEffect, useRef } from "react";
import { useVoiceAgent } from "./useVoiceAgent";

/**
 * Drop-in voice assistant widget.
 *
 * Renders a conversation pane with a microphone button. All audio
 * capture, STT, agent chat, and TTS playback are handled internally.
 *
 * @param {object} props
 * @param {string} [props.baseUrl=""]       API base URL
 * @param {number} [props.debounceMs=1500]  Silence debounce (ms)
 * @param {boolean} [props.autoGreet=true]  Play greeting on connect
 * @param {string} [props.title="Voice Assistant"]  Header title
 * @param {number} [props.bargeInMinChars=20]  Min transcript chars before barge-in
 */
export function VoiceWidget({
  baseUrl,
  debounceMs,
  autoGreet,
  bargeInMinChars,
  title = "Voice Assistant",
}) {
  const {
    messages,
    statusClass,
    isRecording,
    toggleRecording,
  } = useVoiceAgent({ baseUrl, debounceMs, autoGreet, bargeInMinChars });

  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="aai-container">
      <header className="aai-header">
        <h1 className="aai-title">{title}</h1>
      </header>

      <div className={`aai-conversation${isRecording ? " aai-active" : ""}`}>
        {messages.map((msg) => {
          if (msg.type === "thinking") {
            return (
              <div key={msg.id} className="aai-msg aai-thinking">
                Thinking<span className="aai-dots" />
              </div>
            );
          }
          return (
            <div key={msg.id} className={`aai-msg aai-${msg.role}`}>
              {msg.text}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="aai-input-area">
        <button
          className={`aai-mic-btn${isRecording ? " aai-recording" : ""}${statusClass ? ` aai-mic-${statusClass}` : ""}`}
          onClick={toggleRecording}
          title="Toggle microphone"
        >
          {statusClass === "speaking" ? (
            <svg viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3z" />
              <path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4z" />
              <path d="M14 3.23v2.06a6.51 6.51 0 0 1 0 13.42v2.06A8.5 8.5 0 0 0 14 3.23z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}

          {statusClass === "listening" && <span className="aai-pulse-ring" />}
          {statusClass === "processing" && (
            <span className="aai-spinner-ring" />
          )}
          {statusClass === "speaking" && (
            <span className="aai-speaking-ring" />
          )}
        </button>
      </div>
    </div>
  );
}
