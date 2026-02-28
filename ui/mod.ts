// mod.ts — Single public API for @aai/ui.
//
// Re-exports Preact essentials and goober so custom UIs only need
// a single import: `import { css, useEffect, mount, ... } from "@aai/ui"`.

import { h } from "preact";
import { setup } from "goober";

setup(h);

// Preact re-exports (so users don't need preact as a direct dependency)
export { h, Fragment } from "preact";
export {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "preact/hooks";

// Goober re-export
export { css, keyframes, styled } from "goober";

// Session
export { VoiceSession } from "./session.ts";
export type { SessionEventMap } from "./session.ts";
export type { AgentOptions, AgentState, Message } from "./types.ts";

// Signals + context
export { createSessionSignals } from "./signals.ts";
export type { SessionSignals } from "./signals.ts";
export { SessionProvider, useSession } from "./context.tsx";

// Theme
export { applyTheme, darkTheme, defaultTheme } from "./theme.ts";
export type { Theme } from "./theme.ts";

// Mount helper
export { mount } from "./mount.tsx";

// Components (cherry-pick for custom layouts)
export { App } from "./components/App.tsx";
export { ChatView } from "./components/ChatView.tsx";
export { MessageBubble } from "./components/MessageBubble.tsx";
export { StateIndicator } from "./components/StateIndicator.tsx";
export { ErrorBanner } from "./components/ErrorBanner.tsx";
export { Transcript } from "./components/Transcript.tsx";
