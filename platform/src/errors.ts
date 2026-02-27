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
  MISSING_API_KEY: "Missing API key",
  INVALID_CONFIGURE: "First message must be a valid configure message",
  STT_CONNECT_FAILED: "Failed to connect to speech recognition",
  CHAT_FAILED: "Chat failed",
  TTS_FAILED: "TTS synthesis failed",
} as const;

/** Internal error messages (server-side logging / error construction). All entries are functions. */
export const ERR_INTERNAL = {
  sttTokenFailed: (status: number, statusText: string) =>
    `STT token request failed: ${status} ${statusText}`,
  sttConnectionTimeout: () => "STT connection timeout",
  sttMsgParseFailed: () => "Failed to parse STT message",
  llmRequestFailed: (status: number, body: string) => `LLM request failed: ${status} ${body}`,
  toolUnknown: (name: string) => `Error: Unknown tool "${name}"`,
  toolTimeout: (name: string, ms: number) => `Error: Tool "${name}" timed out after ${ms}ms`,
  toolArgsParseFailed: (name: string) => `Failed to parse arguments for tool "${name}"`,

  // Legacy aliases — kept temporarily so callers can be updated incrementally.
  // These will be removed in a future cleanup.
  STT_TOKEN_FAILED: (status: number, statusText: string) =>
    `STT token request failed: ${status} ${statusText}`,
  STT_CONNECTION_TIMEOUT: "STT connection timeout",
  STT_MSG_PARSE_FAILED: "Failed to parse STT message",
  LLM_REQUEST_FAILED: (status: number, body: string) => `LLM request failed: ${status} ${body}`,
  TOOL_UNKNOWN: (name: string) => `Error: Unknown tool "${name}"`,
  TOOL_TIMEOUT: (name: string, ms: number) => `Error: Tool "${name}" timed out after ${ms}ms`,
  TOOL_ARGS_PARSE_FAILED: (name: string) => `Failed to parse arguments for tool "${name}"`,
} as const;
