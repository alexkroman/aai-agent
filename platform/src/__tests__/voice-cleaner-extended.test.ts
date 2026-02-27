import { describe, it, expect } from "vitest";
import { normalizeVoiceText } from "../voice-cleaner.js";

describe("normalizeVoiceText — extended", () => {
  // ── Markdown stripping ──────────────────────────────────────

  it("strips fenced code blocks with language", () => {
    const text = "Here's code:\n```typescript\nconst x = 1;\n```\nDone.";
    expect(normalizeVoiceText(text)).toBe("Here's code:\nDone.");
  });

  it("strips multiple code blocks", () => {
    const text = "```js\na\n```\nText\n```py\nb\n```";
    expect(normalizeVoiceText(text)).toBe("Text");
  });

  it("strips indented code blocks", () => {
    const text = "Normal text\n    indented code\nMore text";
    expect(normalizeVoiceText(text)).toBe("Normal text\nMore text");
  });

  it("handles nested bold and italic", () => {
    expect(normalizeVoiceText("***bold italic***")).toBe("bold italic");
  });

  it("strips images", () => {
    expect(normalizeVoiceText("![alt](https://img.png) text")).toBe("text");
  });

  it("strips horizontal rules", () => {
    expect(normalizeVoiceText("Before\n---\nAfter")).toBe("Before\nAfter");
    expect(normalizeVoiceText("Before\n***\nAfter")).toBe("Before\nAfter");
  });

  it("strips blockquotes", () => {
    expect(normalizeVoiceText("> quoted text")).toBe("quoted text");
    expect(normalizeVoiceText("> line 1\n> line 2")).toBe("line one\nline two");
  });

  it("strips numbered lists", () => {
    expect(normalizeVoiceText("1. First\n2. Second")).toBe("First\nSecond");
  });

  // ── Currency ────────────────────────────────────────────────

  it("expands simple dollar amount", () => {
    const result = normalizeVoiceText("$100");
    expect(result).toContain("one hundred dollars");
  });

  it("expands dollars with cents", () => {
    const result = normalizeVoiceText("$3.50");
    expect(result).toContain("three dollars");
    expect(result).toContain("fifty cents");
  });

  it("expands pounds", () => {
    const result = normalizeVoiceText("£25");
    expect(result).toContain("twenty-five pounds");
  });

  it("expands euros", () => {
    const result = normalizeVoiceText("€10");
    expect(result).toContain("ten euros");
  });

  it("handles comma-separated currency", () => {
    const result = normalizeVoiceText("$1,000");
    expect(result).toContain("one thousand dollars");
  });

  // ── Phone numbers ──────────────────────────────────────────

  it("expands phone numbers digit by digit", () => {
    const result = normalizeVoiceText("Call 555-123-4567");
    expect(result).toContain("five five five");
    expect(result).toContain("one two three");
    expect(result).toContain("four five six seven");
  });

  // ── Units ──────────────────────────────────────────────────

  it("expands Hz to hertz", () => {
    expect(normalizeVoiceText("440Hz")).toContain("hertz");
  });

  it("expands kHz to kilohertz", () => {
    expect(normalizeVoiceText("16kHz")).toContain("kilohertz");
  });

  it("expands MB to megabytes", () => {
    expect(normalizeVoiceText("5MB")).toContain("megabytes");
  });

  it("expands GB to gigabytes", () => {
    expect(normalizeVoiceText("2GB")).toContain("gigabytes");
  });

  it("expands ms to milliseconds", () => {
    expect(normalizeVoiceText("100ms")).toContain("milliseconds");
  });

  // ── Symbols ────────────────────────────────────────────────

  it("replaces fahrenheit symbol", () => {
    expect(normalizeVoiceText("72°F")).toContain("degrees Fahrenheit");
  });

  it("replaces celsius symbol", () => {
    expect(normalizeVoiceText("20°C")).toContain("degrees Celsius");
  });

  it("replaces generic degree symbol", () => {
    expect(normalizeVoiceText("45°")).toContain("degrees");
  });

  it("replaces plus sign", () => {
    expect(normalizeVoiceText("2+2")).toContain("plus");
  });

  it("replaces em dash with comma", () => {
    expect(normalizeVoiceText("word—another")).toBe("word, another");
  });

  it("replaces en dash with comma", () => {
    expect(normalizeVoiceText("word–another")).toBe("word, another");
  });

  it("removes arrow", () => {
    expect(normalizeVoiceText("a → b")).toBe("a b");
  });

  // ── Numbers ────────────────────────────────────────────────

  it("expands large numbers", () => {
    const result = normalizeVoiceText("There are 1000 items");
    expect(result).toContain("one thousand");
  });

  it("expands decimal numbers", () => {
    const result = normalizeVoiceText("The value is 3.14");
    expect(result).toContain("three point one four");
  });

  it("does not expand numbers inside words", () => {
    // Numbers with adjacent word characters should not be expanded
    const result = normalizeVoiceText("version2 update");
    expect(result).toBe("version2 update");
  });

  // ── Whitespace ──────────────────────────────────────────────

  it("collapses multiple spaces to one", () => {
    expect(normalizeVoiceText("a   b   c")).toBe("a b c");
  });

  it("collapses multiple newlines to one", () => {
    expect(normalizeVoiceText("a\n\n\nb")).toBe("a\nb");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeVoiceText("  hello  ")).toBe("hello");
  });

  // ── Edge cases ─────────────────────────────────────────────

  it("handles empty string", () => {
    expect(normalizeVoiceText("")).toBe("");
  });

  it("handles string with only whitespace", () => {
    expect(normalizeVoiceText("   ")).toBe("");
  });

  it("handles string with only markdown", () => {
    expect(normalizeVoiceText("**")).toBe("**");
  });

  it("handles complex mixed content", () => {
    const input =
      "## Summary\n\nThe price is $24.99 (that's **100%** off). Visit [store](https://store.com) or call 555-123-4567.";
    const result = normalizeVoiceText(input);

    // Should not contain markdown
    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
    expect(result).not.toContain("[store]");
    expect(result).not.toContain("https://");

    // Should contain expanded values
    expect(result).toContain("dollars");
    expect(result).toContain("percent");
    expect(result).toContain("five five five");
  });
});
