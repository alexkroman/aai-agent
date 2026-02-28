import { useEffect, useRef } from "preact/hooks";
import type { AgentState, Message } from "../types.ts";
import { StateIndicator } from "./StateIndicator.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { MessageBubble } from "./MessageBubble.tsx";
import { Transcript } from "./Transcript.tsx";
import * as styles from "./styles.ts";

interface ChatViewProps {
  state: AgentState;
  messages: Message[];
  transcript: string;
  error: string;
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
}

export function ChatView(
  { state, messages, transcript, error, running, onToggle, onReset }:
    ChatViewProps,
) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, transcript]);

  return (
    <div style={styles.container}>
      <StateIndicator state={state} />
      <ErrorBanner error={error} />
      <div style={styles.messagesContainer}>
        {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
        <Transcript text={transcript} />
        <div ref={scrollRef} />
      </div>
      <div style={styles.buttonRow}>
        <button
          type="button"
          style={running ? styles.stopButton : styles.resumeButton}
          onClick={onToggle}
        >
          {running ? "Stop" : "Resume"}
        </button>
        <button type="button" style={styles.resetButton} onClick={onReset}>
          New Conversation
        </button>
      </div>
    </div>
  );
}
