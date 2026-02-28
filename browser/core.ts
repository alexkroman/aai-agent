// core.ts — Re-export facade.

export { VoiceSession } from "./session.js";
export type { SessionCallbacks } from "./session.js";

export { toWebSocketUrl } from "./types.js";
export type { AgentState, Message, AgentOptions } from "./types.js";

export { startMicCapture, createAudioPlayer } from "./audio.js";
export type { AudioPlayer } from "./audio.js";

export { SessionError, SessionErrorCode } from "./errors.js";
export { TypedEmitter } from "./emitter.js";
export type { SessionEventMap } from "./emitter.js";
export { ReconnectStrategy } from "./reconnect.js";
