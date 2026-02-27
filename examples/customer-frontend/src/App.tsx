// App.tsx — UI component. This is the only frontend file you edit.
import { useVoiceAgent } from "./hooks/useVoiceAgent";

// These come from the backend's "configured" response.
// Bake into the build via env vars — agentId is safe to expose (not a secret).
const PLATFORM_URL =
  import.meta.env.VITE_PLATFORM_URL ?? "wss://platform.example.com";
const AGENT_ID = import.meta.env.VITE_AGENT_ID ?? "your-agent-id";

export default function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent(
    PLATFORM_URL,
    AGENT_ID
  );

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
