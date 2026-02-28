// Typed error codes for client-side session errors.

export enum SessionErrorCode {
  AUDIO_SETUP_FAILED = "AUDIO_SETUP_FAILED",
  SERVER_ERROR = "SERVER_ERROR",
  MAX_RECONNECTS = "MAX_RECONNECTS",
}

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}
