// Wires session + signals + context + theme + render.

import { render } from "preact";
import type { ComponentType } from "preact";
import { VoiceSession } from "./session.ts";
import {
  createSessionSignals,
  SessionProvider,
  type SessionSignals,
} from "./signals.tsx";
import { applyTheme, defaultTheme, type Theme } from "./theme.ts";

export interface MountOptions {
  theme?: Partial<Theme>;
  target?: string | HTMLElement;
  platformUrl?: string;
}

export interface MountHandle {
  session: VoiceSession;
  signals: SessionSignals;
  dispose(): void;
}

function resolveContainer(target: string | HTMLElement = "#app"): HTMLElement {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) throw new Error(`Element not found: ${target}`);
  return el as HTMLElement;
}

export function mount(
  Component: ComponentType,
  options?: MountOptions,
): MountHandle {
  const container = resolveContainer(options?.target);
  const theme = { ...defaultTheme, ...options?.theme };
  applyTheme(container, theme);

  const platformUrl = options?.platformUrl ??
    new URL(".", import.meta.url).href.replace(/\/$/, "");
  const session = new VoiceSession({ platformUrl });
  const signals = createSessionSignals(session);

  render(
    <SessionProvider value={signals}>
      <Component />
    </SessionProvider>,
    container,
  );

  return {
    session,
    signals,
    dispose() {
      render(null, container);
      session.disconnect();
    },
  };
}
