import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ERR, ERR_INTERNAL } from "../errors.ts";

describe("ERR constants", () => {
  it("has non-empty string values", () => {
    expect(ERR.STT_CONNECT_FAILED).toBeTruthy();
    expect(ERR.CHAT_FAILED).toBeTruthy();
    expect(ERR.TTS_FAILED).toBeTruthy();
  });

  it("values are strings", () => {
    expect(typeof ERR.STT_CONNECT_FAILED).toBe("string");
    expect(typeof ERR.CHAT_FAILED).toBe("string");
    expect(typeof ERR.TTS_FAILED).toBe("string");
  });
});

describe("ERR_INTERNAL formatting functions", () => {
  it("sttTokenFailed includes status and statusText", () => {
    const msg = ERR_INTERNAL.sttTokenFailed(401, "Unauthorized");
    expect(msg).toContain("401");
    expect(msg).toContain("Unauthorized");
  });

  it("sttConnectionTimeout returns a string", () => {
    const msg = ERR_INTERNAL.sttConnectionTimeout();
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("llmRequestFailed includes status and body", () => {
    const msg = ERR_INTERNAL.llmRequestFailed(500, "Internal Server Error");
    expect(msg).toContain("500");
    expect(msg).toContain("Internal Server Error");
  });
});
