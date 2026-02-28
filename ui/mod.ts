// Public API for @aai/ui.

import { h } from "preact";
import { setup } from "goober";

setup(h);

// CSS-in-JS (goober, pre-configured for Preact's h())
export { css, keyframes, styled } from "goober";

// Session
export { VoiceSession } from "./session.ts";
export type { SessionEventMap } from "./session.ts";
export type { AgentOptions, AgentState, Message } from "./types.ts";

// Signals + context
export {
  createSessionSignals,
  SessionProvider,
  useSession,
} from "./signals.tsx";
export type { SessionSignals } from "./signals.tsx";

// Theme
export { applyTheme, darkTheme, defaultTheme } from "./theme.ts";
export type { Theme } from "./theme.ts";

// Mount helper
export { mount } from "./mount.tsx";
export type { MountHandle, MountOptions } from "./mount.tsx";

// Components
export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  Transcript,
} from "./components.tsx";
