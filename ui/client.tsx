// client.tsx — Preact entry: VoiceAgent.start() with default UI.
// Bundled as client.js, served by the agent.

import { render } from "preact";
import type { AgentOptions } from "./types.ts";
import { VoiceSession } from "./session.ts";
import { App } from "./components/App.tsx";

interface StartOptions extends AgentOptions {
  /** CSS selector for the container element, e.g. "#app" */
  element: string;
}

export const VoiceAgent = {
  /**
   * Start a voice agent with the default UI.
   *
   * @example
   * VoiceAgent.start({ element: "#app" });
   */
  start(
    options: StartOptions,
  ): { cancel: () => void; reset: () => void; disconnect: () => void } {
    const container = document.querySelector(options.element);
    if (!container) {
      throw new Error(`Element not found: ${options.element}`);
    }

    const session = new VoiceSession(options);
    render(<App session={session} />, container);

    return {
      cancel: () => session.cancel(),
      reset: () => session.reset(),
      disconnect: () => session.disconnect(),
    };
  },
};
