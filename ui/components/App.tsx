import type { VoiceSession } from "../session.ts";
import { useVoiceSession } from "../hooks/useVoiceSession.ts";
import { ChatView } from "./ChatView.tsx";
import * as styles from "./styles.ts";

export function App({ session }: { session: VoiceSession }) {
  const {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
    reset,
  } = useVoiceSession(session);

  if (!started) {
    return (
      <div style={styles.startWrapper}>
        <button type="button" style={styles.startButton} onClick={start}>
          Start Conversation
        </button>
      </div>
    );
  }

  return (
    <ChatView
      state={state}
      messages={messages}
      transcript={transcript}
      error={error}
      running={running}
      onToggle={toggle}
      onReset={reset}
    />
  );
}
