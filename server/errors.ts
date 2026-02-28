export const ERR = {
  STT_CONNECT_FAILED: "Failed to connect to speech recognition",
  STT_DISCONNECTED: "Speech recognition disconnected",
  CHAT_FAILED: "Chat failed",
  TTS_FAILED: "TTS synthesis failed",
} as const;

export const ERR_INTERNAL = {
  sttTokenFailed: (status: number, statusText: string) =>
    `STT token request failed: ${status} ${statusText}`,
  sttConnectionTimeout: () => "STT connection timeout",
  llmRequestFailed: (status: number, body: string) =>
    `LLM request failed: ${status} ${body}`,
} as const;
