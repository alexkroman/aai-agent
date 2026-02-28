import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { normalizeVoiceText } from "../voice-cleaner.ts";

describe("normalizeVoiceText", () => {
  describe("markdown stripping", () => {
    it("strips bold markdown", () => {
      const result = normalizeVoiceText("This is **bold** text");
      expect(result).not.toContain("**");
      expect(result).toContain("bold");
    });

    it("strips italic markdown", () => {
      const result = normalizeVoiceText("This is *italic* text");
      expect(result).not.toContain("*");
    });

    it("strips heading markdown", () => {
      const result = normalizeVoiceText("# Heading\nSome text");
      expect(result).not.toContain("#");
      expect(result).toContain("Heading");
    });

    it("strips link markdown", () => {
      const result = normalizeVoiceText(
        "Click [here](https://example.com) now",
      );
      expect(result).not.toContain("[");
      expect(result).not.toContain("](");
      expect(result).toContain("here");
    });
  });

  describe("URL removal", () => {
    it("removes http URLs", () => {
      const result = normalizeVoiceText(
        "Visit http://example.com for more",
      );
      expect(result).not.toContain("http://");
    });

    it("removes https URLs", () => {
      const result = normalizeVoiceText(
        "Visit https://example.com/path?q=1 for more",
      );
      expect(result).not.toContain("https://");
    });
  });

  describe("currency expansion", () => {
    it("expands dollar amounts", () => {
      const result = normalizeVoiceText("It costs $7.95");
      expect(result).toContain("seven dollars and ninety-five cents");
    });

    it("expands whole dollar amounts", () => {
      const result = normalizeVoiceText("It costs $100");
      expect(result).toContain("one hundred dollars");
    });

    it("expands euro amounts", () => {
      const result = normalizeVoiceText("Price is €50");
      expect(result).toContain("fifty euros");
    });

    it("expands pound amounts", () => {
      const result = normalizeVoiceText("Price is £25");
      expect(result).toContain("twenty-five pounds");
    });

    it("expands amounts with commas", () => {
      const result = normalizeVoiceText("Salary is $1,000");
      expect(result).toContain("one thousand dollars");
    });
  });

  describe("percentage expansion", () => {
    it("expands percentages", () => {
      const result = normalizeVoiceText("Growth is 15%");
      // Numbers are expanded after percentage replacement
      expect(result).toContain("percent");
    });

    it("expands decimal percentages", () => {
      const result = normalizeVoiceText("Rate is 3.5%");
      expect(result).toContain("percent");
    });
  });

  describe("phone number expansion", () => {
    it("expands phone numbers digit by digit", () => {
      const result = normalizeVoiceText("Call 555-772-9140");
      expect(result).toContain("five five five");
      expect(result).toContain("seven seven two");
    });
  });

  describe("ordinal expansion", () => {
    it("expands 1st to first", () => {
      const result = normalizeVoiceText("the 1st place");
      expect(result).toContain("first");
    });

    it("expands 2nd to second", () => {
      const result = normalizeVoiceText("the 2nd item");
      expect(result).toContain("second");
    });

    it("expands 3rd to third", () => {
      const result = normalizeVoiceText("the 3rd time");
      expect(result).toContain("third");
    });

    it("expands 10th to tenth", () => {
      const result = normalizeVoiceText("the 10th floor");
      expect(result).toContain("tenth");
    });
  });

  describe("unit expansion", () => {
    it("expands Hz to hertz", () => {
      const result = normalizeVoiceText("frequency is 440 Hz");
      expect(result).toContain("hertz");
    });

    it("expands MHz to megahertz", () => {
      const result = normalizeVoiceText("runs at 2 MHz");
      expect(result).toContain("megahertz");
    });

    it("expands GB to gigabytes", () => {
      const result = normalizeVoiceText("has 16 GB of RAM");
      expect(result).toContain("gigabytes");
    });
  });

  describe("number expansion", () => {
    it("expands integers", () => {
      const result = normalizeVoiceText("There are 123 items");
      expect(result).toContain("one hundred twenty-three");
    });

    it("expands decimals", () => {
      const result = normalizeVoiceText("Pi is about 3.14");
      expect(result).toContain("point");
    });

    it("expands zero", () => {
      const result = normalizeVoiceText("The value is 0 now");
      expect(result).toContain("zero");
    });
  });

  describe("symbol replacement", () => {
    it("replaces °F with degrees Fahrenheit", () => {
      const result = normalizeVoiceText("It is 72°F outside");
      expect(result).toContain("degrees Fahrenheit");
    });

    it("replaces °C with degrees Celsius", () => {
      const result = normalizeVoiceText("It is 22°C today");
      expect(result).toContain("degrees Celsius");
    });

    it("replaces & with and", () => {
      const result = normalizeVoiceText("salt & pepper");
      expect(result).toContain("salt and pepper");
    });

    it("replaces + with plus", () => {
      const result = normalizeVoiceText("2+2");
      expect(result).toContain("plus");
    });

    it("removes arrow →", () => {
      const result = normalizeVoiceText("go → next");
      expect(result).not.toContain("→");
    });

    it("replaces em-dash — with comma", () => {
      const result = normalizeVoiceText("this — that");
      expect(result).toContain(",");
    });
  });

  describe("whitespace collapsing", () => {
    it("collapses multiple spaces", () => {
      const result = normalizeVoiceText("too   many    spaces");
      expect(result).toBe("too many spaces");
    });

    it("collapses multiple newlines", () => {
      const result = normalizeVoiceText("line1\n\n\n\nline2");
      expect(result).toBe("line1\nline2");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = normalizeVoiceText("");
      expect(result).toBe("");
    });

    it("handles only whitespace", () => {
      const result = normalizeVoiceText("   ");
      expect(result).toBe("");
    });

    it("handles negative numbers", () => {
      // -5 is processed as minus sign + number; the regex may or may not catch it
      // depending on context. Just verify it doesn't crash.
      const result = normalizeVoiceText("temperature is -5 degrees");
      expect(result).toContain("five");
      expect(result).toContain("degrees");
    });
  });
});
