// errors.ts — Typed error codes for client-side session errors.

export enum SessionErrorCode {
  CONNECTION_FAILED = "CONNECTION_FAILED",
  CONNECTION_LOST = "CONNECTION_LOST",
  MIC_ACCESS_DENIED = "MIC_ACCESS_DENIED",
  AUDIO_SETUP_FAILED = "AUDIO_SETUP_FAILED",
  SERVER_ERROR = "SERVER_ERROR",
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  MAX_RECONNECTS = "MAX_RECONNECTS",
}

const RECOVERABLE_CODES = new Set<SessionErrorCode>([
  SessionErrorCode.CONNECTION_LOST,
  SessionErrorCode.SERVER_ERROR,
]);

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly recoverable: boolean;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.recoverable = RECOVERABLE_CODES.has(code);
  }
}
