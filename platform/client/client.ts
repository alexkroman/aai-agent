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

function renderUI(
  container: HTMLElement,
  state: AgentState,
  messages: Message[],
  transcript: string,
  onCancel: () => void,
  onReset: () => void
): void {
  const stateColor: Record<AgentState, string> = {
    connecting: "#999",
    ready: "#4CAF50",
    listening: "#2196F3",
    thinking: "#FF9800",
    speaking: "#9C27B0",
  };

  container.innerHTML = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
        <div style="width: 12px; height: 12px; border-radius: 50%; background: ${stateColor[state]}"></div>
        <span style="font-size: 14px; color: #666; text-transform: capitalize">${state}</span>
      </div>

      <div style="min-height: 300px; max-height: 500px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
        ${messages
          .map(
            (m) => `
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
        `
          )
          .join("")}
        ${
          transcript
            ? `
          <div style="margin-bottom: 12px; text-align: right;">
            <div style="display: inline-block; max-width: 80%; padding: 8px 12px; border-radius: 12px; background: #e3f2fd; opacity: 0.6; text-align: left;">
              <div style="font-size: 14px;">${escapeHtml(transcript)}</div>
            </div>
          </div>
        `
            : ""
        }
      </div>

      <div style="display: flex; gap: 8px;">
        <button onclick="this.__cancel()" ${state !== "speaking" ? "disabled" : ""} style="padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; background: white; cursor: pointer; font-size: 14px;">Stop</button>
        <button onclick="this.__reset()" style="padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; background: white; cursor: pointer; font-size: 14px;">New Conversation</button>
      </div>
    </div>
  `;

  // Attach handlers to buttons
  const buttons = container.querySelectorAll("button");
  (buttons[0] as any).__cancel = onCancel;
  (buttons[1] as any).__reset = onReset;

  // Scroll messages to bottom
  const msgDiv = container.querySelector("div > div:nth-child(2)") as HTMLElement;
  if (msgDiv) msgDiv.scrollTop = msgDiv.scrollHeight;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const VoiceAgent = {
  /**
   * Start a voice agent with the default UI.
   *
   * @example
   * VoiceAgent.start({
   *   element: "#app",
   *   apiKey: "pk_...",
   *   instructions: "You are a helpful assistant.",
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

    let session: VoiceSession;

    const render = () => {
      renderUI(
        container as HTMLElement,
        state,
        messages,
        transcript,
        () => session.cancel(),
        () => {
          session.reset();
          messages.length = 0;
          transcript = "";
          render();
        }
      );
    };

    session = new VoiceSession(options, {
      onStateChange(newState) {
        state = newState;
        render();
      },
      onMessage(msg) {
        messages.push(msg);
        render();
      },
      onTranscript(text) {
        transcript = text;
        render();
      },
    });

    render();
    session.connect();

    return {
      cancel: () => session.cancel(),
      reset: () => {
        session.reset();
        messages.length = 0;
        transcript = "";
        render();
      },
      disconnect: () => session.disconnect(),
    };
  },
};
