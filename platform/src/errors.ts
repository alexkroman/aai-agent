// errors.ts — Centralized error message constants.

/** Error messages sent to the browser (user-facing). */
export const ERR = {
  MISSING_API_KEY: "Missing API key",
  INVALID_CONFIGURE: "First message must be a valid configure message",
  STT_CONNECT_FAILED: "Failed to connect to speech recognition",
  CHAT_FAILED: "Chat failed",
  TTS_FAILED: "TTS synthesis failed",
} as const;

/** Internal error messages (server-side logging / error construction). */
export const ERR_INTERNAL = {
  STT_TOKEN_FAILED: (status: number, statusText: string) =>
    `STT token request failed: ${status} ${statusText}`,
  STT_CONNECTION_TIMEOUT: "STT connection timeout",
  LLM_REQUEST_FAILED: (status: number, body: string) => `LLM request failed: ${status} ${body}`,
  TOOL_UNKNOWN: (name: string) => `Error: Unknown tool "${name}"`,
  TOOL_TIMEOUT: (name: string, ms: number) => `Error: Tool "${name}" timed out after ${ms}ms`,
} as const;
