// App.tsx — UI component. Edit this to customize the voice agent UI.

import { useState, useEffect, useRef } from "react";
import { instructions, greeting, voice, tools } from "./agent";

// Platform URL — change for production
const PLATFORM =
  import.meta.env.VITE_PLATFORM_URL || "http://localhost:3000";

export default function App() {
  const [hook, setHook] = useState<any>(null);

  useEffect(() => {
    // Load the voice agent hook from the platform server
    import(/* @vite-ignore */ `${PLATFORM}/react.js`).then(setHook);
  }, []);

  if (!hook) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner} />
        <p>Connecting to platform...</p>
      </div>
    );
  }

  return <VoiceUI useVoiceAgent={hook.useVoiceAgent} />;
}

const STATE_META: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  connecting: { label: "Connecting", color: "#94a3b8", icon: "..." },
  ready: { label: "Ready", color: "#22c55e", icon: "\u25CF" },
  listening: { label: "Listening", color: "#3b82f6", icon: "\u25CF" },
  thinking: { label: "Thinking", color: "#f59e0b", icon: "\u25CF" },
  speaking: { label: "Speaking", color: "#a855f7", icon: "\u25CF" },
};

function VoiceUI({ useVoiceAgent }: { useVoiceAgent: any }) {
  const { state, messages, transcript, cancel, reset } = useVoiceAgent({
    apiKey: import.meta.env.VITE_API_KEY || "pk_your_publishable_key",
    platformUrl: PLATFORM,
    instructions,
    greeting,
    voice,
    tools,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const meta = STATE_META[state] ?? STATE_META.connecting;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, transcript]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>TechStore Support</h1>
          <p style={styles.subtitle}>Powered by voice AI</p>
        </div>
        <div style={styles.statusBadge}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: meta.color,
              boxShadow:
                state === "listening" || state === "speaking"
                  ? `0 0 8px ${meta.color}`
                  : "none",
            }}
          >
            {meta.icon}
          </span>
          <span style={{ color: meta.color, fontWeight: 500 }}>
            {meta.label}
          </span>
        </div>
      </header>

      {/* Messages */}
      <div style={styles.messageList}>
        {messages.length === 0 && !transcript && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>
              {state === "connecting"
                ? "Connecting..."
                : "Start talking to Nova"}
            </p>
            <p style={styles.emptyHint}>
              Try: "I'd like to return an item" or "Do you have the new
              headphones in stock?"
            </p>
          </div>
        )}

        {messages.map((m: any, i: number) => (
          <div
            key={i}
            style={{
              ...styles.messageBubbleRow,
              justifyContent:
                m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                ...styles.messageBubble,
                ...(m.role === "user"
                  ? styles.userBubble
                  : styles.assistantBubble),
              }}
            >
              <div style={styles.messageText}>{m.text}</div>
              {m.steps && m.steps.length > 0 && (
                <div style={styles.steps}>
                  {m.steps.map((s: string, j: number) => (
                    <span key={j} style={styles.stepChip}>
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {transcript && (
          <div
            style={{
              ...styles.messageBubbleRow,
              justifyContent: "flex-end",
            }}
          >
            <div
              style={{
                ...styles.messageBubble,
                ...styles.userBubble,
                opacity: 0.6,
              }}
            >
              <div style={styles.messageText}>{transcript}</div>
            </div>
          </div>
        )}

        {state === "thinking" && (
          <div style={styles.messageBubbleRow}>
            <div
              style={{ ...styles.messageBubble, ...styles.assistantBubble }}
            >
              <div style={styles.thinkingDots}>
                <span style={styles.dot} />
                <span style={{ ...styles.dot, animationDelay: "0.2s" }} />
                <span style={{ ...styles.dot, animationDelay: "0.4s" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <button
          onClick={cancel}
          disabled={state !== "speaking"}
          style={{
            ...styles.button,
            ...(state === "speaking"
              ? styles.cancelButton
              : styles.disabledButton),
          }}
        >
          Stop Speaking
        </button>
        <button
          onClick={reset}
          style={{ ...styles.button, ...styles.resetButton }}
        >
          New Conversation
        </button>
      </div>
    </div>
  );
}

// ── Inline styles (no CSS file needed) ──────────────────────────

const styles: Record<string, React.CSSProperties> = {
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#64748b",
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid #e2e8f0",
    borderTopColor: "#3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: 16,
  },
  container: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: 640,
    margin: "0 auto",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#fafafa",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    backgroundColor: "#fff",
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    fontSize: 12,
    color: "#94a3b8",
  },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
  },
  statusDot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    fontSize: 0,
    lineHeight: 0,
    transition: "all 0.3s ease",
  },
  messageList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    color: "#94a3b8",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 500,
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 13,
    maxWidth: 300,
  },
  messageBubbleRow: {
    display: "flex",
  },
  messageBubble: {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 1.5,
  },
  userBubble: {
    backgroundColor: "#3b82f6",
    color: "#fff",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: "#fff",
    color: "#0f172a",
    border: "1px solid #e2e8f0",
    borderBottomLeftRadius: 4,
  },
  messageText: {
    wordBreak: "break-word" as const,
  },
  steps: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 4,
    marginTop: 6,
  },
  stepChip: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    color: "#3b82f6",
  },
  thinkingDots: {
    display: "flex",
    gap: 4,
    padding: "4px 0",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: "#94a3b8",
    animation: "bounce 1.2s ease-in-out infinite",
  },
  controls: {
    display: "flex",
    gap: 8,
    padding: "12px 20px",
    borderTop: "1px solid #e2e8f0",
    backgroundColor: "#fff",
  },
  button: {
    flex: 1,
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  cancelButton: {
    backgroundColor: "#ef4444",
    color: "#fff",
  },
  resetButton: {
    backgroundColor: "#f1f5f9",
    color: "#475569",
    border: "1px solid #e2e8f0",
  },
  disabledButton: {
    backgroundColor: "#f1f5f9",
    color: "#cbd5e1",
    cursor: "not-allowed",
  },
};
