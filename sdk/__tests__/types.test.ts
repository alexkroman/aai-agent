import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  VOICE_RULES,
} from "../types.ts";

describe("default constants", () => {
  it("DEFAULT_INSTRUCTIONS is a non-empty string", () => {
    expect(typeof DEFAULT_INSTRUCTIONS).toBe("string");
    expect(DEFAULT_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it("DEFAULT_GREETING is a non-empty string", () => {
    expect(typeof DEFAULT_GREETING).toBe("string");
    expect(DEFAULT_GREETING.length).toBeGreaterThan(0);
  });

  it("VOICE_RULES is a non-empty string", () => {
    expect(typeof VOICE_RULES).toBe("string");
    expect(VOICE_RULES.length).toBeGreaterThan(0);
  });
});
