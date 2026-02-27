import { describe, it, expect } from "vitest";
import { ERR, ERR_INTERNAL } from "../errors.js";

describe("ERR (browser-facing error messages)", () => {
  it("has all expected error messages", () => {
    expect(ERR.MISSING_API_KEY).toBe("Missing API key");
    expect(ERR.INVALID_CONFIGURE).toBe("First message must be a valid configure message");
    expect(ERR.STT_CONNECT_FAILED).toBe("Failed to connect to speech recognition");
    expect(ERR.CHAT_FAILED).toBe("Chat failed");
    expect(ERR.TTS_FAILED).toBe("TTS synthesis failed");
  });
});

describe("ERR_INTERNAL (server-side error messages)", () => {
  it("STT_TOKEN_FAILED includes status code", () => {
    const msg = ERR_INTERNAL.STT_TOKEN_FAILED(401, "Unauthorized");
    expect(msg).toBe("STT token request failed: 401 Unauthorized");
  });

  it("STT_CONNECTION_TIMEOUT is a string", () => {
    expect(ERR_INTERNAL.STT_CONNECTION_TIMEOUT).toBe("STT connection timeout");
  });

  it("LLM_REQUEST_FAILED includes status and body", () => {
    const msg = ERR_INTERNAL.LLM_REQUEST_FAILED(500, "Internal Server Error");
    expect(msg).toBe("LLM request failed: 500 Internal Server Error");
  });

  it("TOOL_UNKNOWN includes tool name", () => {
    const msg = ERR_INTERNAL.TOOL_UNKNOWN("my_tool");
    expect(msg).toBe('Error: Unknown tool "my_tool"');
  });

  it("TOOL_TIMEOUT includes tool name and ms", () => {
    const msg = ERR_INTERNAL.TOOL_TIMEOUT("slow_tool", 30000);
    expect(msg).toBe('Error: Tool "slow_tool" timed out after 30000ms');
  });
});
