// errors.ts — Centralized error message constants.

import type { ZodError } from "zod";

/** Format a ZodError into a flat array of human-readable strings. */
export function formatZodErrors(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Error messages sent to the browser (user-facing). */
export const ERR = {
  STT_CONNECT_FAILED: "Failed to connect to speech recognition",
  CHAT_FAILED: "Chat failed",
  TTS_FAILED: "TTS synthesis failed",
} as const;

/** Internal error messages (server-side logging / error construction). */
export const ERR_INTERNAL = {
  sttTokenFailed: (status: number, statusText: string) =>
    `STT token request failed: ${status} ${statusText}`,
  sttConnectionTimeout: () => "STT connection timeout",
  sttMsgParseFailed: () => "Failed to parse STT message",
  llmRequestFailed: (status: number, body: string) =>
    `LLM request failed: ${status} ${body}`,
  toolUnknown: (name: string) => `Error: Unknown tool "${name}"`,
  toolTimeout: (name: string, ms: number) =>
    `Error: Tool "${name}" timed out after ${ms}ms`,
  toolArgsParseFailed: (name: string) =>
    `Failed to parse arguments for tool "${name}"`,
} as const;
