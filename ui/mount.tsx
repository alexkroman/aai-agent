// Wires session + signals + context + theme + render.

import { render } from "preact";
import type { ComponentType } from "preact";
import { VoiceSession } from "./session.ts";
import { createSessionSignals } from "./signals.ts";
import { SessionProvider } from "./context.tsx";
import { applyTheme, defaultTheme, type Theme } from "./theme.ts";

export function mount(
  Component: ComponentType,
  options?: { theme?: Partial<Theme> },
) {
  return {
    start(
      { element, platformUrl }: { element: string; platformUrl?: string },
    ): { cancel: () => void; reset: () => void; disconnect: () => void } {
      const container = document.querySelector(element);
      if (!container) throw new Error(`Element not found: ${element}`);

      const theme = { ...defaultTheme, ...options?.theme };
      applyTheme(container as HTMLElement, theme);
      document.body.style.margin = "0";
      document.body.style.background = theme.bg;
      document.body.style.color = theme.text;
      document.body.style.fontFamily = theme.font;

      const session = new VoiceSession({ platformUrl });
      const signals = createSessionSignals(session);

      render(
        <SessionProvider value={signals}>
          <Component />
        </SessionProvider>,
        container,
      );

      return {
        cancel: () => session.cancel(),
        reset: () => session.reset(),
        disconnect: () => session.disconnect(),
      };
    },
  };
}
