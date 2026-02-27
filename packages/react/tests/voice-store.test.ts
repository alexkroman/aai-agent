import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceAgent } from "../src/useVoiceAgent";

describe("useVoiceAgent", () => {
  it("starts with empty messages and default status", () => {
    const { result } = renderHook(() => useVoiceAgent());
    expect(result.current.messages).toEqual([]);
    expect(result.current.turnPhase).toBe("listening");
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("returns stable toggleRecording and clearMessages references", () => {
    const { result, rerender } = renderHook(() => useVoiceAgent());
    const first = result.current;
    rerender();
    expect(result.current.toggleRecording).toBe(first.toggleRecording);
    expect(result.current.clearMessages).toBe(first.clearMessages);
  });

  it("clearMessages empties the message list", () => {
    const { result } = renderHook(() => useVoiceAgent());
    act(() => result.current.clearMessages());
    expect(result.current.messages).toEqual([]);
  });
});
