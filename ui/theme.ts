// theme.ts — CSS custom property theme system. Zero runtime overhead.

import type { AgentState } from "./types.ts";

export interface Theme {
  bg: string;
  surface: string;
  surfaceLight: string;
  primary: string;
  text: string;
  textMuted: string;
  error: string;
  font: string;
  radius: string;
  stateColors: Record<AgentState, string>;
}

export const defaultTheme: Theme = {
  bg: "#ffffff",
  surface: "#f5f5f5",
  surfaceLight: "#e0e0e0",
  primary: "#2196F3",
  text: "#000000",
  textMuted: "#666666",
  error: "#f44336",
  font: "system-ui, -apple-system, sans-serif",
  radius: "8px",
  stateColors: {
    connecting: "#999",
    ready: "#4CAF50",
    listening: "#2196F3",
    thinking: "#FF9800",
    speaking: "#9C27B0",
    error: "#f44336",
  },
};

export const darkTheme: Theme = {
  bg: "#0f0e17",
  surface: "#1a1a2e",
  surfaceLight: "#2b2c3f",
  primary: "#7f5af0",
  text: "#fffffe",
  textMuted: "#94a1b2",
  error: "#ff6b6b",
  font: "'SF Mono', 'Fira Code', monospace",
  radius: "8px",
  stateColors: {
    connecting: "#94a1b2",
    ready: "#72f1b8",
    listening: "#7f5af0",
    thinking: "#e2b714",
    speaking: "#ff6480",
    error: "#ff6b6b",
  },
};

export function applyTheme(el: HTMLElement, theme: Theme): void {
  const s = el.style;
  s.setProperty("--aai-bg", theme.bg);
  s.setProperty("--aai-surface", theme.surface);
  s.setProperty("--aai-surface-light", theme.surfaceLight);
  s.setProperty("--aai-primary", theme.primary);
  s.setProperty("--aai-text", theme.text);
  s.setProperty("--aai-text-muted", theme.textMuted);
  s.setProperty("--aai-error", theme.error);
  s.setProperty("--aai-font", theme.font);
  s.setProperty("--aai-radius", theme.radius);
  for (const [state, color] of Object.entries(theme.stateColors)) {
    s.setProperty(`--aai-state-${state}`, color);
  }
}
