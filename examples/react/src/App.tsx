// App.tsx — UI component. Edit this to customize the voice agent UI.

import { useState, useEffect } from "react";
import { config, tools } from "./agent";

// Platform URL — change for production
const PLATFORM = import.meta.env.VITE_PLATFORM_URL || "http://localhost:3000";

export default function App() {
  const [hook, setHook] = useState<any>(null);

  useEffect(() => {
    // Load the voice agent hook from the platform server
    import(/* @vite-ignore */ `${PLATFORM}/react.js`).then(setHook);
  }, []);

  if (!hook) return <div style={{ padding: 20 }}>Loading voice agent...</div>;

  return <VoiceUI useVoiceAgent={hook.useVoiceAgent} />;
}

function VoiceUI({ useVoiceAgent }: { useVoiceAgent: any }) {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: import.meta.env.VITE_API_KEY,
    platformUrl: PLATFORM.replace("http", "ws"),
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
