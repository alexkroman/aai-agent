// client.tsx — Custom dark-mode UI for Night Owl.

import {
  css,
  darkTheme,
  ErrorBanner,
  MessageBubble,
  mount,
  StateIndicator,
  Transcript,
  useEffect,
  useRef,
  useSession,
} from "@aai/ui";

const heroClass = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 24px;
`;

const heroIconClass = css`
  font-size: 48px;
`;

const heroTitleClass = css`
  font-size: 24px;
  font-weight: 600;
  margin: 0;
`;

const heroSubtitleClass = css`
  color: var(--aai-text-muted);
  font-size: 14px;
  margin: 0;
`;

const heroStartClass = css`
  margin-top: 16px;
  padding: 14px 36px;
  background: var(--aai-primary);
  color: var(--aai-text);
  border: none;
  border-radius: var(--aai-radius);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  letter-spacing: 0.5px;
`;

const containerClass = css`
  max-width: 640px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;
  box-sizing: border-box;
`;

const headerClass = css`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--aai-surface-light);
`;

const headerIconClass = css`
  font-size: 20px;
`;

const headerTitleClass = css`
  font-size: 16px;
  font-weight: 600;
`;

const headerStatusClass = css`
  margin-left: auto;
`;

const messagesClass = css`
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
  margin-bottom: 16px;
  border: 1px solid var(--aai-surface-light);
  border-radius: var(--aai-radius);
  padding: 16px;
  background: var(--aai-surface);
`;

const controlsClass = css`
  display: flex;
  gap: 8px;
`;

const btnToggleClass = css`
  padding: 10px 20px;
  border: none;
  border-radius: var(--aai-radius);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  color: var(--aai-bg);
`;

const btnResetClass = css`
  padding: 10px 20px;
  border: 1px solid var(--aai-surface-light);
  border-radius: var(--aai-radius);
  background: transparent;
  color: var(--aai-text-muted);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
`;

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
      <div class={heroClass}>
        <div class={heroIconClass}>&#x1F989;</div>
        <h1 class={heroTitleClass}>Night Owl</h1>
        <p class={heroSubtitleClass}>your evening companion</p>
        <button type="button" class={heroStartClass} onClick={start}>
          Start Conversation
        </button>
      </div>
    );
  }

  return (
    <div class={containerClass}>
      <div class={headerClass}>
        <div class={headerIconClass}>&#x1F989;</div>
        <span class={headerTitleClass}>Night Owl</span>
        <div class={headerStatusClass}>
          <StateIndicator state={state.value} />
        </div>
      </div>

      <ErrorBanner error={error.value} />

      <div class={messagesClass}>
        {messages.value.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <Transcript text={transcript.value} />
        <div ref={scrollRef} />
      </div>

      <div class={controlsClass}>
        <button
          type="button"
          class={btnToggleClass}
          style={{
            background: running.value
              ? "var(--aai-state-speaking)"
              : "var(--aai-state-ready)",
          }}
          onClick={toggle}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button type="button" class={btnResetClass} onClick={reset}>
          New Conversation
        </button>
      </div>
    </div>
  );
}

export const VoiceAgent = mount(NightOwl, { theme: darkTheme });
