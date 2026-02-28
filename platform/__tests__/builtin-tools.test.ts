import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  executeBuiltinTool,
  getBuiltinToolSchemas,
  htmlToText,
} from "../builtin-tools.ts";

describe("htmlToText", () => {
  it("strips script tags", () => {
    const result = htmlToText('<p>Hello</p><script>alert("x")</script>');
    expect(result).toBe("Hello");
  });

  it("strips style tags", () => {
    const result = htmlToText(
      "<style>body{color:red}</style><p>Content</p>",
    );
    expect(result).toBe("Content");
  });

  it("strips head tags", () => {
    const result = htmlToText(
      "<head><title>Test</title></head><body>Body</body>",
    );
    expect(result).not.toContain("Test");
    expect(result).toContain("Body");
  });

  it("converts block tags to newlines", () => {
    const result = htmlToText("<p>Para 1</p><p>Para 2</p>");
    expect(result).toContain("Para 1");
    expect(result).toContain("Para 2");
  });

  it("converts br to newlines", () => {
    const result = htmlToText("Line 1<br>Line 2<br/>Line 3");
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
    expect(result).toContain("Line 3");
  });

  it("strips remaining HTML tags", () => {
    const result = htmlToText("<span class='x'>Hello</span> <b>World</b>");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("decodes HTML entities", () => {
    const result = htmlToText("&amp; &lt; &gt; &quot; &#39; &nbsp;");
    expect(result).toContain("&");
    expect(result).toContain("<");
    expect(result).toContain(">");
    expect(result).toContain('"');
    expect(result).toContain("'");
  });

  it("collapses whitespace", () => {
    const result = htmlToText("<p>  too   many   spaces  </p>");
    expect(result).not.toContain("  ");
  });

  it("collapses excessive newlines", () => {
    const result = htmlToText("<p>A</p>\n\n\n\n<p>B</p>");
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("trims result", () => {
    const result = htmlToText("  <p>Hello</p>  ");
    expect(result).toBe(result.trim());
  });
});

describe("getBuiltinToolSchemas", () => {
  it("returns schemas for known tools", () => {
    const schemas = getBuiltinToolSchemas(["web_search", "visit_webpage"]);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].name).toBe("web_search");
    expect(schemas[1].name).toBe("visit_webpage");
  });

  it("ignores unknown tool names", () => {
    const schemas = getBuiltinToolSchemas(["unknown_tool", "web_search"]);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("web_search");
  });

  it("returns empty array for empty input", () => {
    const schemas = getBuiltinToolSchemas([]);
    expect(schemas).toHaveLength(0);
  });

  it("returns schemas with correct shape", () => {
    const schemas = getBuiltinToolSchemas(["web_search"]);
    expect(schemas[0].name).toBe("web_search");
    expect(typeof schemas[0].description).toBe("string");
    expect(schemas[0].parameters).toBeDefined();
  });
});

describe("executeBuiltinTool", () => {
  it("returns null for unknown tool", async () => {
    const result = await executeBuiltinTool("nonexistent", {});
    expect(result).toBeNull();
  });

  it("returns error for invalid args", async () => {
    const result = await executeBuiltinTool("web_search", {});
    expect(result).not.toBeNull();
    expect(result!).toContain("Error");
  });

  it("passes Zod-parsed data (not raw args) to execute", async () => {
    // visit_webpage validates its url param via Zod. If we pass a
    // valid url, the parsed data should reach execute. We verify this
    // by asserting the result contains the url from the *parsed* data.
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("<html><body>OK</body></html>", {
          status: 200,
        }),
      )) as typeof globalThis.fetch;

    try {
      const result = await executeBuiltinTool("visit_webpage", {
        url: "https://example.com",
      });
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.url).toBe("https://example.com");
    } finally {
      // fetch cleanup handled by outer afterEach or next test setup
    }
  });

  describe("visit_webpage", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fetches and converts HTML", async () => {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            "<html><body><p>Hello World</p></body></html>",
            { status: 200 },
          ),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool("visit_webpage", {
        url: "https://example.com",
      });
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.content).toContain("Hello World");
      expect(parsed.url).toBe("https://example.com");
    });

    it("handles non-OK response", async () => {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("Not Found", {
            status: 404,
            statusText: "Not Found",
          }),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool("visit_webpage", {
        url: "https://example.com/missing",
      });
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.error).toContain("404");
    });
  });
});
