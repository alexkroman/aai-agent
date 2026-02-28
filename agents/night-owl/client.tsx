// client.tsx — Custom dark-mode UI for Night Owl using @aai/ui.

import {
  darkTheme,
  ErrorBanner,
  MessageBubble,
  mount,
  StateIndicator,
  Transcript,
  useSession,
} from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";

function NightOwl() {
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
  } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  if (!started.value) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: "24px",
        }}
      >
        <div style={{ fontSize: "48px" }}>&#x1F989;</div>
        <h1 style={{ fontSize: "24px", fontWeight: "600", margin: 0 }}>
          Night Owl
        </h1>
        <p
          style={{
            color: "var(--aai-text-muted)",
            fontSize: "14px",
            margin: 0,
          }}
        >
          your evening companion
        </p>
        <button
          type="button"
          onClick={start}
          style={{
            marginTop: "16px",
            padding: "14px 36px",
            background: "var(--aai-primary)",
            color: "var(--aai-text)",
            border: "none",
            borderRadius: "var(--aai-radius)",
            fontSize: "15px",
            fontWeight: "500",
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.5px",
          }}
        >
          Start Conversation
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: "640px",
        margin: "0 auto",
        padding: "24px",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "20px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--aai-surface-light)",
        }}
      >
        <div style={{ fontSize: "20px" }}>&#x1F989;</div>
        <span style={{ fontSize: "16px", fontWeight: "600" }}>Night Owl</span>
        <div style={{ marginLeft: "auto" }}>
          <StateIndicator state={state.value} />
        </div>
      </div>

      <ErrorBanner error={error.value} />

      <div
        style={{
          minHeight: "300px",
          maxHeight: "500px",
          overflowY: "auto",
          marginBottom: "16px",
          border: "1px solid var(--aai-surface-light)",
          borderRadius: "var(--aai-radius)",
          padding: "16px",
          background: "var(--aai-surface)",
        }}
      >
        {messages.value.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
          />
        ))}
        <Transcript text={transcript.value} />
        <div ref={scrollRef} />
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={toggle}
          style={{
            padding: "10px 20px",
            border: "none",
            borderRadius: "var(--aai-radius)",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "inherit",
            fontWeight: "500",
            background: running.value
              ? "var(--aai-state-speaking)"
              : "var(--aai-state-ready)",
            color: "var(--aai-bg)",
          }}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "10px 20px",
            border: "1px solid var(--aai-surface-light)",
            borderRadius: "var(--aai-radius)",
            background: "transparent",
            color: "var(--aai-text-muted)",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "inherit",
          }}
        >
          New Conversation
        </button>
      </div>
    </div>
  );
}

export const VoiceAgent = mount(NightOwl, { theme: darkTheme });
