// styles.ts — Centralized inline style objects for the voice agent UI.

import type { AgentState } from "../types.ts";

export const STATE_COLORS: Record<AgentState, string> = {
  connecting: "#999",
  ready: "#4CAF50",
  listening: "#2196F3",
  thinking: "#FF9800",
  speaking: "#9C27B0",
  error: "#f44336",
} as const;

export const container: Record<string, string> = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  maxWidth: "600px",
  margin: "0 auto",
  padding: "20px",
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
  borderRadius: "12px",
  background: "#2196F3",
  color: "white",
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
  color: "#666",
  textTransform: "capitalize",
} as const;

export const errorBanner: Record<string, string> = {
  background: "#ffebee",
  color: "#c62828",
  padding: "10px 14px",
  borderRadius: "8px",
  marginBottom: "16px",
  fontSize: "14px",
} as const;

export const messagesContainer: Record<string, string> = {
  minHeight: "300px",
  maxHeight: "500px",
  overflowY: "auto",
  marginBottom: "16px",
  border: "1px solid #e0e0e0",
  borderRadius: "8px",
  padding: "16px",
} as const;

export const buttonRow: Record<string, string> = {
  display: "flex",
  gap: "8px",
} as const;

export const stopButton: Record<string, string> = {
  padding: "8px 16px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  background: "#f44336",
  color: "white",
} as const;

export const resumeButton: Record<string, string> = {
  padding: "8px 16px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  background: "#4CAF50",
  color: "white",
} as const;

export const resetButton: Record<string, string> = {
  padding: "8px 16px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "white",
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
  borderRadius: "12px",
  background: isUser ? "#e3f2fd" : "#f5f5f5",
  textAlign: "left",
});

export const bubbleText: Record<string, string> = {
  fontSize: "14px",
} as const;

export const stepsText: Record<string, string> = {
  fontSize: "11px",
  color: "#999",
  marginTop: "4px",
} as const;

export const transcriptBubble: Record<string, string> = {
  display: "inline-block",
  maxWidth: "80%",
  padding: "8px 12px",
  borderRadius: "12px",
  background: "#e3f2fd",
  opacity: "0.6",
  textAlign: "left",
} as const;
