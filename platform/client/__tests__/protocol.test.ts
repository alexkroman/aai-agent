import { describe, it, expect } from "vitest";
import { parseServerMessage } from "../protocol.js";

describe("parseServerMessage", () => {
  it("parses valid server messages", () => {
    const msg = parseServerMessage('{"type":"ready","sampleRate":16000,"ttsSampleRate":24000}');
    expect(msg).toEqual({ type: "ready", sampleRate: 16000, ttsSampleRate: 24000 });
  });

  it("returns null for malformed JSON", () => {
    expect(parseServerMessage("not json")).toBeNull();
  });

  it("returns null for unknown message types", () => {
    expect(parseServerMessage('{"type":"unknown_type"}')).toBeNull();
  });

  it("returns null for missing type field", () => {
    expect(parseServerMessage('{"data":"test"}')).toBeNull();
  });
});
