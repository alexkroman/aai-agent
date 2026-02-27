// App.tsx — UI component. This is the only frontend file you edit.
// @ts-expect-error — platform-served module
import { useVoiceAgent } from "https://platform.example.com/react.js";
import { config, tools } from "./agent";

export default function App() {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: import.meta.env.VITE_API_KEY,
    config,
    tools,
  });

  return (
    <div className="voice-agent">
      <div className="status">{state}</div>

      <div className="messages">
        {messages.map((m: any, i: number) => (
          <div key={i} className={`message ${m.role}`}>
            <span>{m.text}</span>
            {m.steps?.map((s: string, j: number) => (
              <span key={j} className="step">{s}</span>
            ))}
          </div>
        ))}
        {transcript && <div className="message user partial">{transcript}</div>}
      </div>

      <div className="controls">
        <button onClick={cancel} disabled={state !== "speaking"}>Stop</button>
        <button onClick={reset}>New Conversation</button>
      </div>
    </div>
  );
}
