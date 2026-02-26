import { describe, it, expect } from "vitest";
import { getPCMWorkletUrl } from "../src/pcm-worklet";

describe("getPCMWorkletUrl", () => {
  it("returns a blob URL string", () => {
    const url = getPCMWorkletUrl();
    expect(url).toMatch(/^blob:/);
  });

  it("returns the same URL on repeated calls (cached)", () => {
    const url1 = getPCMWorkletUrl();
    const url2 = getPCMWorkletUrl();
    expect(url1).toBe(url2);
  });
});
