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
  it("STT_TOKEN_FAILED formats status and statusText", () => {
    expect(ERR_INTERNAL.STT_TOKEN_FAILED(401, "Unauthorized")).toBe(
      "STT token request failed: 401 Unauthorized"
    );
  });

  it("STT_CONNECTION_TIMEOUT is a string constant", () => {
    expect(ERR_INTERNAL.STT_CONNECTION_TIMEOUT).toBe("STT connection timeout");
  });

  it("LLM_REQUEST_FAILED formats status and body", () => {
    expect(ERR_INTERNAL.LLM_REQUEST_FAILED(500, "Internal Error")).toBe(
      "LLM request failed: 500 Internal Error"
    );
  });

  it("TOOL_UNKNOWN formats tool name", () => {
    expect(ERR_INTERNAL.TOOL_UNKNOWN("my_tool")).toBe('Error: Unknown tool "my_tool"');
  });

  it("TOOL_TIMEOUT formats tool name and ms", () => {
    expect(ERR_INTERNAL.TOOL_TIMEOUT("slow_tool", 30000)).toBe(
      'Error: Tool "slow_tool" timed out after 30000ms'
    );
  });
});
