import { describe, it, expect } from "vitest";
import {
  MSG,
  TIMEOUTS,
  PATHS,
  SAMPLE_RATES,
  ISOLATE_MEMORY_LIMIT_MB,
  MAX_TOOL_ITERATIONS,
} from "../constants.js";

describe("MSG", () => {
  it("has all server→browser message types", () => {
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
  });

  it("has all browser→server message types", () => {
    expect(MSG.CONFIGURE).toBe("configure");
    expect(MSG.CANCEL).toBe("cancel");
  });
});

describe("TIMEOUTS", () => {
  it("has correct timeout values", () => {
    expect(TIMEOUTS.STT_CONNECTION).toBe(10_000);
    expect(TIMEOUTS.TOOL_HANDLER).toBe(30_000);
    expect(TIMEOUTS.STT_TOKEN_EXPIRES).toBe(480);
  });
});

describe("PATHS", () => {
  it("has correct path values", () => {
    expect(PATHS.WEBSOCKET).toBe("/session");
    expect(PATHS.HEALTH).toBe("/health");
    expect(PATHS.CLIENT_JS).toBe("/client.js");
    expect(PATHS.REACT_JS).toBe("/react.js");
  });
});

describe("SAMPLE_RATES", () => {
  it("has correct sample rates", () => {
    expect(SAMPLE_RATES.STT).toBe(16_000);
    expect(SAMPLE_RATES.TTS).toBe(24_000);
  });
});

describe("numeric constants", () => {
  it("ISOLATE_MEMORY_LIMIT_MB is 128", () => {
    expect(ISOLATE_MEMORY_LIMIT_MB).toBe(128);
  });

  it("MAX_TOOL_ITERATIONS is 3", () => {
    expect(MAX_TOOL_ITERATIONS).toBe(3);
  });
});
