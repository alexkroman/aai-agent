import type { PCMDecodeResult } from "./types";

/**
 * Decode a base64-encoded PCM16 LE chunk into an Int16Array.
 * Handles odd byte lengths by truncating to the nearest even boundary.
 */
export function decodeBase64PCM(data: string): PCMDecodeResult {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const sampleCount = (bin.length & ~1) >> 1;
  return { int16: new Int16Array(bytes.buffer, 0, sampleCount), sampleCount };
}
