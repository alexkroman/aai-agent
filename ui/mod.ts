/** @module @aai/ui */

import { h } from "preact";
import { setup } from "goober";

setup(h);

export { css, keyframes, styled } from "goober";

export { VoiceSession } from "./session.ts";
export type { SessionEventMap } from "./session.ts";
export type { AgentOptions, AgentState, Message } from "./types.ts";

export {
  createSessionSignals,
  SessionProvider,
  useSession,
} from "./signals.tsx";
export type { SessionSignals } from "./signals.tsx";

export { applyTheme, darkTheme, defaultTheme } from "./theme.ts";
export type { Theme } from "./theme.ts";

export { mount } from "./mount.tsx";
export type { MountHandle, MountOptions } from "./mount.tsx";

export { FAVICON_SVG, renderAgentPage } from "./html.ts";

export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  Transcript,
} from "./components.tsx";
