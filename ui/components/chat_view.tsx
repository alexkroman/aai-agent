import { useEffect, useRef } from "preact/hooks";
import { useSession } from "../context.tsx";
import { StateIndicator } from "./state_indicator.tsx";
import { ErrorBanner } from "./error_banner.tsx";
import { MessageBubble } from "./message_bubble.tsx";
import { Transcript } from "./transcript.tsx";
import * as styles from "./styles.ts";

export function ChatView() {
  const { state, messages, transcript, error, running, toggle, reset } =
    useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  return (
    <div style={styles.container}>
      <StateIndicator state={state.value} />
      <ErrorBanner error={error.value} />
      <div style={styles.messagesContainer}>
        {messages.value.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
          />
        ))}
        <Transcript text={transcript.value} />
        <div ref={scrollRef} />
      </div>
      <div style={styles.buttonRow}>
        <button
          type="button"
          style={running.value ? styles.stopButton : styles.resumeButton}
          onClick={toggle}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button type="button" style={styles.resetButton} onClick={reset}>
          New Conversation
        </button>
      </div>
    </div>
  );
}
