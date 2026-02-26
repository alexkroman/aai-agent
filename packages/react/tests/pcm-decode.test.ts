import { describe, it, expect } from "vitest";
import { decodeBase64PCM } from "../src/pcm-decode";

describe("decodeBase64PCM", () => {
  it("decodes base64 into Int16Array samples", () => {
    // Two 16-bit LE samples: 0x0100 (256) and 0xFF7F (32767)
    const bytes = new Uint8Array([0x00, 0x01, 0xFF, 0x7F]);
    const b64 = btoa(String.fromCharCode(...bytes));

    const { int16, sampleCount } = decodeBase64PCM(b64);
    expect(sampleCount).toBe(2);
    expect(int16[0]).toBe(256);
    expect(int16[1]).toBe(32767);
  });

  it("handles odd byte length by truncating to even", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xFF]);
    const b64 = btoa(String.fromCharCode(...bytes));

    const { int16, sampleCount } = decodeBase64PCM(b64);
    expect(sampleCount).toBe(1);
    expect(int16[0]).toBe(256);
  });

  it("returns zero samples for single byte", () => {
    const b64 = btoa(String.fromCharCode(0x42));
    const { sampleCount } = decodeBase64PCM(b64);
    expect(sampleCount).toBe(0);
  });

  it("returns zero samples for empty input", () => {
    const b64 = btoa("");
    const { sampleCount } = decodeBase64PCM(b64);
    expect(sampleCount).toBe(0);
  });

  it("correctly decodes negative samples", () => {
    // -1 in 16-bit LE = 0xFF 0xFF
    const bytes = new Uint8Array([0xFF, 0xFF]);
    const b64 = btoa(String.fromCharCode(...bytes));

    const { int16, sampleCount } = decodeBase64PCM(b64);
    expect(sampleCount).toBe(1);
    expect(int16[0]).toBe(-1);
  });

  it("decodes silence (all zeros)", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const b64 = btoa(String.fromCharCode(...bytes));

    const { int16, sampleCount } = decodeBase64PCM(b64);
    expect(sampleCount).toBe(2);
    expect(int16[0]).toBe(0);
    expect(int16[1]).toBe(0);
  });
});
