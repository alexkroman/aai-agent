// core.ts — Re-export facade for backward compatibility.
// All client modules import from ./core.js; this facade means zero import path changes.

export { VoiceSession } from "./session.js";
export type { SessionCallbacks } from "./session.js";

export { serializeTools } from "./types.js";
export type { AgentState, Message, ToolDef, AgentOptions } from "./types.js";

export { startMicCapture, createAudioPlayer } from "./audio.js";
export type { AudioPlayer } from "./audio.js";

export { CLIENT_MSG, parseServerMessage } from "./protocol.js";
export type { ServerMessage } from "./protocol.js";

export { SessionError, SessionErrorCode } from "./errors.js";
export { TypedEmitter } from "./emitter.js";
export type { SessionEventMap } from "./emitter.js";
export { ReconnectStrategy } from "./reconnect.js";
