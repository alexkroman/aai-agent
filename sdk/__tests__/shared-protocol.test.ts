import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { MAX_TOOL_ITERATIONS, MSG, TIMEOUTS } from "../shared-protocol.ts";

describe("MSG constants", () => {
  it("has all server → browser message types", () => {
    expect(MSG.READY).toBe("ready");
    expect(MSG.GREETING).toBe("greeting");
    expect(MSG.TRANSCRIPT).toBe("transcript");
    expect(MSG.TURN).toBe("turn");
    expect(MSG.THINKING).toBe("thinking");
    expect(MSG.CHAT).toBe("chat");
    expect(MSG.TTS_DONE).toBe("tts_done");
    expect(MSG.CANCELLED).toBe("cancelled");
    expect(MSG.ERROR).toBe("error");
    expect(MSG.RESET).toBe("reset");
    expect(MSG.PONG).toBe("pong");
  });

  it("has all browser → server message types", () => {
    expect(MSG.AUDIO_READY).toBe("audio_ready");
    expect(MSG.CANCEL).toBe("cancel");
    expect(MSG.PING).toBe("ping");
  });
});

describe("TIMEOUTS", () => {
  it("STT_CONNECTION is a positive number", () => {
    expect(TIMEOUTS.STT_CONNECTION).toBeGreaterThan(0);
  });

  it("TOOL_HANDLER is a positive number", () => {
    expect(TIMEOUTS.TOOL_HANDLER).toBeGreaterThan(0);
  });

  it("STT_TOKEN_EXPIRES is a positive number", () => {
    expect(TIMEOUTS.STT_TOKEN_EXPIRES).toBeGreaterThan(0);
  });
});

describe("MAX_TOOL_ITERATIONS", () => {
  it("is a positive number", () => {
    expect(MAX_TOOL_ITERATIONS).toBeGreaterThan(0);
  });
});
