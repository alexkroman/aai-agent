// styles.ts — Centralized inline style objects using CSS custom properties.

import type { AgentState } from "../types.ts";

export const STATE_COLORS: Record<AgentState, string> = {
  connecting: "var(--aai-state-connecting)",
  ready: "var(--aai-state-ready)",
  listening: "var(--aai-state-listening)",
  thinking: "var(--aai-state-thinking)",
  speaking: "var(--aai-state-speaking)",
  error: "var(--aai-state-error)",
} as const;

export const container: Record<string, string> = {
  fontFamily: "var(--aai-font)",
  maxWidth: "600px",
  margin: "0 auto",
  padding: "20px",
  color: "var(--aai-text)",
  minHeight: "100vh",
  boxSizing: "border-box",
} as const;

export const startWrapper: Record<string, string> = {
  ...container,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "300px",
} as const;

export const startButton: Record<string, string> = {
  padding: "16px 32px",
  border: "none",
  borderRadius: "var(--aai-radius)",
  background: "var(--aai-primary)",
  color: "var(--aai-text)",
  fontSize: "16px",
  fontWeight: "500",
  cursor: "pointer",
} as const;

export const stateRow: Record<string, string> = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "16px",
} as const;

export const stateDot = (state: AgentState): Record<string, string> => ({
  width: "12px",
  height: "12px",
  borderRadius: "50%",
  background: STATE_COLORS[state],
});

export const stateLabel: Record<string, string> = {
  fontSize: "14px",
  color: "var(--aai-text-muted)",
  textTransform: "capitalize",
} as const;

export const errorBanner: Record<string, string> = {
  background: "var(--aai-surface)",
  color: "var(--aai-error)",
  padding: "10px 14px",
  borderRadius: "var(--aai-radius)",
  marginBottom: "16px",
  fontSize: "14px",
} as const;

export const messagesContainer: Record<string, string> = {
  minHeight: "300px",
  maxHeight: "500px",
  overflowY: "auto",
  marginBottom: "16px",
  border: "1px solid var(--aai-surface-light)",
  borderRadius: "var(--aai-radius)",
  padding: "16px",
} as const;

export const buttonRow: Record<string, string> = {
  display: "flex",
  gap: "8px",
} as const;

export const stopButton: Record<string, string> = {
  padding: "8px 16px",
  border: "none",
  borderRadius: "var(--aai-radius)",
  cursor: "pointer",
  fontSize: "14px",
  background: "var(--aai-error)",
  color: "var(--aai-text)",
} as const;

export const resumeButton: Record<string, string> = {
  padding: "8px 16px",
  border: "none",
  borderRadius: "var(--aai-radius)",
  cursor: "pointer",
  fontSize: "14px",
  background: "var(--aai-state-ready)",
  color: "var(--aai-text)",
} as const;

export const resetButton: Record<string, string> = {
  padding: "8px 16px",
  border: "1px solid var(--aai-surface-light)",
  borderRadius: "var(--aai-radius)",
  background: "transparent",
  color: "var(--aai-text-muted)",
  cursor: "pointer",
  fontSize: "14px",
} as const;

export const bubbleRow = (isUser: boolean): Record<string, string> => ({
  marginBottom: "12px",
  textAlign: isUser ? "right" : "left",
});

export const bubble = (isUser: boolean): Record<string, string> => ({
  display: "inline-block",
  maxWidth: "80%",
  padding: "8px 12px",
  borderRadius: "var(--aai-radius)",
  background: isUser ? "var(--aai-surface-light)" : "var(--aai-surface)",
  textAlign: "left",
});

export const bubbleText: Record<string, string> = {
  fontSize: "14px",
} as const;

export const stepsText: Record<string, string> = {
  fontSize: "11px",
  color: "var(--aai-text-muted)",
  marginTop: "4px",
} as const;

export const transcriptBubble: Record<string, string> = {
  display: "inline-block",
  maxWidth: "80%",
  padding: "8px 12px",
  borderRadius: "var(--aai-radius)",
  background: "var(--aai-surface-light)",
  opacity: "0.6",
  textAlign: "left",
} as const;
