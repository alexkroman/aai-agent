// App.tsx — UI component. This is the only frontend file you edit.
import { useVoiceAgent } from "./hooks/useVoiceAgent";

// frontendUrl comes from the backend's "configured" response.
// In dev, hardcode it or pass via env var. In prod, fetch from your backend.
const FRONTEND_URL =
  import.meta.env.VITE_FRONTEND_URL ??
  "wss://platform.example.com/session/abc?token=xyz";

export default function App() {
  const { state, messages, transcript, cancel, reset } =
    useVoiceAgent(FRONTEND_URL);

  return (
    <div className="voice-agent">
      <div className="status">{state}</div>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <span>{m.text}</span>
            {m.steps?.map((s, j) => (
              <span key={j} className="step">
                {s}
              </span>
            ))}
          </div>
        ))}
        {transcript && (
          <div className="message user partial">{transcript}</div>
        )}
      </div>

      <div className="controls">
        <button onClick={cancel} disabled={state !== "speaking"}>
          Stop
        </button>
        <button onClick={reset}>New Conversation</button>
      </div>
    </div>
  );
}
