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
 */
export function VoiceWidget({
  baseUrl,
  debounceMs,
  autoGreet,
  title = "Voice Assistant",
}) {
  const {
    messages,
    liveTranscript,
    showTranscript,
    statusText,
    statusClass,
    isRecording,
    toggleRecording,
  } = useVoiceAgent({ baseUrl, debounceMs, autoGreet });

  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="aai-container">
      <header className="aai-header">
        <h1 className="aai-title">{title}</h1>
      </header>

      <div className="aai-conversation">
        {messages.map((msg) => {
          if (msg.type === "thinking") {
            return (
              <div key={msg.id} className="aai-msg aai-thinking">
                Thinking<span className="aai-dots" />
              </div>
            );
          }
          if (msg.type === "steps") {
            return (
              <div key={msg.id} className="aai-steps">
                {msg.steps.join(" \u2192 ")}
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
        <div className={`aai-live-transcript${showTranscript ? " aai-visible" : ""}`}>
          {liveTranscript}
        </div>

        <button
          className={`aai-mic-btn${isRecording ? " aai-recording" : ""}`}
          onClick={toggleRecording}
          title="Toggle microphone"
        >
          <svg viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        </button>

        <div className={`aai-status${statusClass ? ` aai-${statusClass}` : ""}`}>
          {statusText}
        </div>
      </div>
    </div>
  );
}
