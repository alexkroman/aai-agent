import { describe, it, expect } from "vitest";
import { ERR, ERR_INTERNAL } from "../errors.js";

describe("ERR (browser-facing errors)", () => {
  it("has correct error strings", () => {
    expect(ERR.MISSING_API_KEY).toBe("Missing API key");
    expect(ERR.INVALID_CONFIGURE).toBe("First message must be a valid configure message");
    expect(ERR.STT_CONNECT_FAILED).toBe("Failed to connect to speech recognition");
    expect(ERR.CHAT_FAILED).toBe("Chat failed");
    expect(ERR.TTS_FAILED).toBe("TTS synthesis failed");
  });
});

describe("ERR_INTERNAL (server-side errors)", () => {
  it("sttTokenFailed formats status and statusText", () => {
    expect(ERR_INTERNAL.sttTokenFailed(401, "Unauthorized")).toBe(
      "STT token request failed: 401 Unauthorized"
    );
  });

  it("sttConnectionTimeout returns the expected string", () => {
    expect(ERR_INTERNAL.sttConnectionTimeout()).toBe("STT connection timeout");
  });

  it("llmRequestFailed formats status and body", () => {
    expect(ERR_INTERNAL.llmRequestFailed(500, "Internal Error")).toBe(
      "LLM request failed: 500 Internal Error"
    );
  });

  it("toolUnknown formats tool name", () => {
    expect(ERR_INTERNAL.toolUnknown("my_tool")).toBe('Error: Unknown tool "my_tool"');
  });

  it("toolTimeout formats tool name and ms", () => {
    expect(ERR_INTERNAL.toolTimeout("slow_tool", 30000)).toBe(
      'Error: Tool "slow_tool" timed out after 30000ms'
    );
  });

  it("toolArgsParseFailed formats tool name", () => {
    expect(ERR_INTERNAL.toolArgsParseFailed("my_tool")).toBe(
      'Failed to parse arguments for tool "my_tool"'
    );
  });

  it("sttMsgParseFailed returns the expected string", () => {
    expect(ERR_INTERNAL.sttMsgParseFailed()).toBe("Failed to parse STT message");
  });
});
