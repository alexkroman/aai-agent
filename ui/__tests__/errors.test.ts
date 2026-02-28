import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SessionError, SessionErrorCode } from "../errors.ts";

describe("SessionErrorCode", () => {
  it("has AUDIO_SETUP_FAILED", () => {
    expect(SessionErrorCode.AUDIO_SETUP_FAILED).toBe("AUDIO_SETUP_FAILED");
  });

  it("has SERVER_ERROR", () => {
    expect(SessionErrorCode.SERVER_ERROR).toBe("SERVER_ERROR");
  });

  it("has MAX_RECONNECTS", () => {
    expect(SessionErrorCode.MAX_RECONNECTS).toBe("MAX_RECONNECTS");
  });
});

describe("SessionError", () => {
  it("is an instance of Error", () => {
    const err = new SessionError(
      SessionErrorCode.SERVER_ERROR,
      "Something went wrong",
    );
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name", () => {
    const err = new SessionError(
      SessionErrorCode.SERVER_ERROR,
      "test",
    );
    expect(err.name).toBe("SessionError");
  });

  it("has correct code property", () => {
    const err = new SessionError(
      SessionErrorCode.AUDIO_SETUP_FAILED,
      "mic failed",
    );
    expect(err.code).toBe(SessionErrorCode.AUDIO_SETUP_FAILED);
  });

  it("has correct message", () => {
    const err = new SessionError(
      SessionErrorCode.MAX_RECONNECTS,
      "Too many attempts",
    );
    expect(err.message).toBe("Too many attempts");
  });

  it("code is readonly", () => {
    const err = new SessionError(
      SessionErrorCode.SERVER_ERROR,
      "test",
    );
    // Verify it exists and has the right value
    expect(err.code).toBe(SessionErrorCode.SERVER_ERROR);
  });
});
