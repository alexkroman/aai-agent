// core.ts — Re-export facade.

export { VoiceSession } from "./session.ts";
export type { SessionCallbacks, SessionEventMap } from "./session.ts";

export type { AgentOptions, AgentState, Message } from "./types.ts";

export { createAudioPlayer, startMicCapture } from "./audio.ts";
export type { AudioPlayer } from "./audio.ts";

export { SessionError, SessionErrorCode } from "./errors.ts";
export { ReconnectStrategy } from "./reconnect.ts";
