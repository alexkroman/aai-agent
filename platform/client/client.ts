// client.ts — Vanilla JS entry: VoiceAgent.start() with default UI.
// Bundled as client.js, served by the platform.

import {
  VoiceSession,
  type AgentOptions,
  type AgentState,
  type Message,
} from "./core.js";

interface StartOptions extends AgentOptions {
  /** CSS selector for the container element, e.g. "#app" */
  element: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const STATE_COLORS: Record<AgentState, string> = {
  connecting: "#999",
  ready: "#4CAF50",
  listening: "#2196F3",
  thinking: "#FF9800",
  speaking: "#9C27B0",
  error: "#f44336",
};

function renderInitialUI(container: HTMLElement): void {
  container.innerHTML = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
        <div data-role="dot" style="width: 12px; height: 12px; border-radius: 50%; background: ${STATE_COLORS.connecting}"></div>
        <span data-role="state-label" style="font-size: 14px; color: #666; text-transform: capitalize">connecting</span>
      </div>

      <div data-role="error" style="display: none; background: #ffebee; color: #c62828; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px;"></div>

      <div data-role="messages" style="min-height: 300px; max-height: 500px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;"></div>

      <div style="display: flex; gap: 8px;">
        <button data-action="cancel" disabled style="padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; background: white; cursor: pointer; font-size: 14px;">Stop</button>
        <button data-action="reset" style="padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; background: white; cursor: pointer; font-size: 14px;">New Conversation</button>
      </div>
    </div>
  `;
}

function updateState(container: HTMLElement, state: AgentState): void {
  const dot = container.querySelector('[data-role="dot"]') as HTMLElement | null;
  const label = container.querySelector('[data-role="state-label"]') as HTMLElement | null;
  const cancelBtn = container.querySelector('[data-action="cancel"]') as HTMLButtonElement | null;
  if (dot) dot.style.background = STATE_COLORS[state];
  if (label) label.textContent = state;
  if (cancelBtn) cancelBtn.disabled = state !== "speaking";
}

function renderMessageBubble(m: Message): string {
  return `
    <div style="margin-bottom: 12px; ${m.role === "user" ? "text-align: right" : ""}">
      <div style="display: inline-block; max-width: 80%; padding: 8px 12px; border-radius: 12px; background: ${
        m.role === "user" ? "#e3f2fd" : "#f5f5f5"
      }; text-align: left;">
        <div style="font-size: 14px;">${escapeHtml(m.text)}</div>
        ${
          m.steps && m.steps.length > 0
            ? `<div style="font-size: 11px; color: #999; margin-top: 4px;">${m.steps.map(escapeHtml).join(" → ")}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function appendMessages(container: HTMLElement, messages: Message[], startIndex: number): void {
  const msgDiv = container.querySelector('[data-role="messages"]');
  if (!msgDiv) return;
  for (let i = startIndex; i < messages.length; i++) {
    msgDiv.insertAdjacentHTML("beforeend", renderMessageBubble(messages[i]));
  }
  msgDiv.scrollTop = msgDiv.scrollHeight;
}

function updateTranscript(container: HTMLElement, transcript: string): void {
  const msgDiv = container.querySelector('[data-role="messages"]');
  if (!msgDiv) return;
  let bubble = msgDiv.querySelector('[data-role="transcript"]') as HTMLElement | null;
  if (transcript) {
    const html = `
      <div style="margin-bottom: 12px; text-align: right;">
        <div style="display: inline-block; max-width: 80%; padding: 8px 12px; border-radius: 12px; background: #e3f2fd; opacity: 0.6; text-align: left;">
          <div style="font-size: 14px;">${escapeHtml(transcript)}</div>
        </div>
      </div>
    `;
    if (bubble) {
      bubble.innerHTML = html;
    } else {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-role", "transcript");
      wrapper.innerHTML = html;
      msgDiv.appendChild(wrapper);
    }
  } else if (bubble) {
    bubble.remove();
  }
  msgDiv.scrollTop = msgDiv.scrollHeight;
}

function updateError(container: HTMLElement, error: string): void {
  const el = container.querySelector('[data-role="error"]') as HTMLElement | null;
  if (!el) return;
  if (error) {
    el.textContent = error;
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

export const VoiceAgent = {
  /**
   * Start a voice agent with the default UI.
   *
   * @example
   * VoiceAgent.start({
   *   element: "#app",
   *   apiKey: "pk_...",
   *   config: { instructions: "You are a helpful assistant." },
   *   tools: { ... },
   * });
   */
  start(options: StartOptions): { cancel: () => void; reset: () => void; disconnect: () => void } {
    const container = document.querySelector(options.element);
    if (!container) {
      throw new Error(`Element not found: ${options.element}`);
    }

    let state: AgentState = "connecting";
    const messages: Message[] = [];
    let transcript = "";
    let error = "";
    let started = false;
    let lastRenderedMessageCount = 0;

    let session: VoiceSession;

    const render = () => {
      if (!started) {
        (container as HTMLElement).innerHTML = `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 300px;">
            <button id="__voice-start" style="padding: 16px 32px; border: none; border-radius: 12px; background: #2196F3; color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
              Start Conversation
            </button>
          </div>`;
        (container as HTMLElement).querySelector("#__voice-start")!.addEventListener("click", () => {
          started = true;
          session.connect();
          renderStarted();
        });
        return;
      }
      renderStarted();
    };

    const renderStarted = () => {
      // First time: render full skeleton
      if (!container.querySelector('[data-role="messages"]')) {
        renderInitialUI(container as HTMLElement);
        lastRenderedMessageCount = 0;
        // Attach button event handlers
        const cancelBtn = container.querySelector('[data-action="cancel"]');
        const resetBtn = container.querySelector('[data-action="reset"]');
        cancelBtn?.addEventListener("click", () => session.cancel());
        resetBtn?.addEventListener("click", () => session.reset());
      }
      // Targeted updates
      updateState(container as HTMLElement, state);
      updateError(container as HTMLElement, error);
      if (messages.length > lastRenderedMessageCount) {
        appendMessages(container as HTMLElement, messages, lastRenderedMessageCount);
        lastRenderedMessageCount = messages.length;
      }
      updateTranscript(container as HTMLElement, transcript);
    };

    session = new VoiceSession(options, {
      onStateChange(newState) {
        state = newState;
        if (started) {
          updateState(container as HTMLElement, state);
        }
      },
      onMessage(msg) {
        messages.push(msg);
        if (started) {
          appendMessages(container as HTMLElement, messages, lastRenderedMessageCount);
          lastRenderedMessageCount = messages.length;
        }
      },
      onTranscript(text) {
        transcript = text;
        if (started) {
          updateTranscript(container as HTMLElement, transcript);
        }
      },
      onError(message) {
        error = message;
        if (started) {
          updateError(container as HTMLElement, error);
        }
      },
    });

    session.on("reset", () => {
      messages.length = 0;
      transcript = "";
      error = "";
      lastRenderedMessageCount = 0;
      if (started) {
        const msgDiv = container.querySelector('[data-role="messages"]');
        if (msgDiv) msgDiv.innerHTML = "";
        updateError(container as HTMLElement, "");
      }
    });

    render();

    return {
      cancel: () => session.cancel(),
      reset: () => session.reset(),
      disconnect: () => session.disconnect(),
    };
  },
};
