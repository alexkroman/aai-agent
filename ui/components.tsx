// Default UI components for voice agents.

import { css } from "goober";
import { useEffect, useRef } from "preact/hooks";
import type { AgentState, Message } from "./types.ts";
import { useSession } from "./signals.tsx";

// ── Styles ──────────────────────────────────────────────────────

const layout = css`
  font-family: var(--aai-font);
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  color: var(--aai-text);
  min-height: 100vh;
  box-sizing: border-box;
`;

const hero = css`
  font-family: var(--aai-font);
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  color: var(--aai-text);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;

  & button {
    padding: 16px 32px;
    border: none;
    border-radius: var(--aai-radius);
    background: var(--aai-primary);
    color: var(--aai-text);
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
  }
`;

const indicator = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;

  & .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  & .label {
    font-size: 14px;
    color: var(--aai-text-muted);
    text-transform: capitalize;
  }
`;

const errorBanner = css`
  background: var(--aai-surface);
  color: var(--aai-error);
  padding: 10px 14px;
  border-radius: var(--aai-radius);
  margin-bottom: 16px;
  font-size: 14px;
`;

const messageArea = css`
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
  margin-bottom: 16px;
  border: 1px solid var(--aai-surface-light);
  border-radius: var(--aai-radius);
  padding: 16px;
`;

const controls = css`
  display: flex;
  gap: 8px;

  & button {
    padding: 8px 16px;
    border: none;
    border-radius: var(--aai-radius);
    cursor: pointer;
    font-size: 14px;
    color: var(--aai-text);
  }
  & .reset {
    border: 1px solid var(--aai-surface-light);
    background: transparent;
    color: var(--aai-text-muted);
  }
`;

const bubble = css`
  margin-bottom: 12px;

  &.user {
    text-align: right;
  }

  & .content {
    display: inline-block;
    max-width: 80%;
    padding: 8px 12px;
    border-radius: var(--aai-radius);
    text-align: left;
    font-size: 14px;
    background: var(--aai-surface);
  }
  &.user .content {
    background: var(--aai-surface-light);
  }

  & .steps {
    font-size: 11px;
    color: var(--aai-text-muted);
    margin-top: 4px;
  }

  &.transcript .content {
    background: var(--aai-surface-light);
    opacity: 0.6;
  }
`;

// ── Components ──────────────────────────────────────────────────

export function StateIndicator({ state }: { state: AgentState }) {
  return (
    <div class={indicator}>
      <div class="dot" style={{ background: `var(--aai-state-${state})` }} />
      <span class="label">{state}</span>
    </div>
  );
}

export function ErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return <div class={errorBanner}>{error}</div>;
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div class={`${bubble} ${isUser ? "user" : ""}`}>
      <div class="content">
        <div>{message.text}</div>
        {message.steps && message.steps.length > 0 && (
          <div class="steps">{message.steps.join(" \u2192 ")}</div>
        )}
      </div>
    </div>
  );
}

export function Transcript({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div class={`${bubble} user transcript`}>
      <div class="content">
        <div>{text}</div>
      </div>
    </div>
  );
}

export function ChatView() {
  const { state, messages, transcript, error, running, toggle, reset } =
    useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  return (
    <div class={layout}>
      <StateIndicator state={state.value} />
      <ErrorBanner error={error.value} />
      <div class={messageArea}>
        {messages.value.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
          />
        ))}
        <Transcript text={transcript.value} />
        <div ref={scrollRef} />
      </div>
      <div class={controls}>
        <button
          type="button"
          style={{
            background: running.value
              ? "var(--aai-error)"
              : "var(--aai-state-ready)",
          }}
          onClick={toggle}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button type="button" class="reset" onClick={reset}>
          New Conversation
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { started, start } = useSession();

  if (!started.value) {
    return (
      <div class={hero}>
        <button type="button" onClick={start}>
          Start Conversation
        </button>
      </div>
    );
  }

  return <ChatView />;
}
