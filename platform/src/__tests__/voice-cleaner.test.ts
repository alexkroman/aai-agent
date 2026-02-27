import { describe, it, expect } from "vitest";
import { normalizeVoiceText } from "../voice-cleaner.js";

describe("normalizeVoiceText", () => {
  it("strips markdown bold/italic", () => {
    expect(normalizeVoiceText("This is **bold** and *italic*")).toBe(
      "This is bold and italic"
    );
  });

  it("strips markdown headers", () => {
    expect(normalizeVoiceText("## Header\nSome text")).toBe(
      "Header\nSome text"
    );
  });

  it("strips markdown links", () => {
    expect(normalizeVoiceText("Click [here](https://example.com)")).toBe(
      "Click here"
    );
  });

  it("strips code blocks", () => {
    expect(normalizeVoiceText("```js\ncode\n```\nText")).toBe("Text");
  });

  it("strips inline code", () => {
    expect(normalizeVoiceText("Run `npm install`")).toBe("Run npm install");
  });

  it("removes URLs", () => {
    expect(normalizeVoiceText("Visit https://example.com for more")).toBe(
      "Visit for more"
    );
  });

  it("expands currency", () => {
    const result = normalizeVoiceText("It costs $7.95");
    expect(result).toContain("seven dollars");
    expect(result).toContain("ninety-five cents");
  });

  it("expands percentages", () => {
    expect(normalizeVoiceText("100% complete")).toBe(
      "one hundred percent complete"
    );
  });

  it("expands ordinals", () => {
    expect(normalizeVoiceText("the 1st place")).toBe("the first place");
    expect(normalizeVoiceText("the 2nd place")).toBe("the second place");
    expect(normalizeVoiceText("the 3rd place")).toBe("the third place");
  });

  it("expands numbers", () => {
    expect(normalizeVoiceText("there are 42 items")).toBe(
      "there are forty-two items"
    );
  });

  it("replaces symbols", () => {
    expect(normalizeVoiceText("hot & cold")).toBe("hot and cold");
    expect(normalizeVoiceText("72°F")).toBe("seventy-two degrees Fahrenheit");
  });

  it("collapses whitespace", () => {
    expect(normalizeVoiceText("too    many    spaces")).toBe(
      "too many spaces"
    );
  });

  it("strips bullet lists", () => {
    expect(normalizeVoiceText("- item 1\n- item 2")).toBe("item one\nitem two");
  });
});
