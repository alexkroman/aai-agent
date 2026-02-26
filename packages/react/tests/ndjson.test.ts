import { describe, it, expect } from "vitest";
import { parseNDJSON } from "../src/ndjson";

/** Helper: create a fake Response whose body yields the given chunks. */
function fakeResponse(chunks: string[]): Response {
  let i = 0;
  const encoder = new TextEncoder();
  const body = {
    getReader() {
      return {
        read() {
          if (i < chunks.length) {
            return Promise.resolve({ done: false as const, value: encoder.encode(chunks[i++]) });
          }
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
  return { body } as unknown as Response;
}

describe("parseNDJSON", () => {
  it("parses a single complete line", async () => {
    const resp = fakeResponse(['{"type":"reply","text":"hi"}\n']);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toEqual([{ type: "reply", text: "hi" }]);
  });

  it("parses multiple lines in one chunk", async () => {
    const resp = fakeResponse(['{"a":1}\n{"a":2}\n{"a":3}\n']);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ a: 1 });
    expect(results[2]).toEqual({ a: 3 });
  });

  it("handles lines split across chunks", async () => {
    const resp = fakeResponse(['{"ty', 'pe":"done"}\n']);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toEqual([{ type: "done" }]);
  });

  it("handles final line without trailing newline", async () => {
    const resp = fakeResponse(['{"x":1}']);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toEqual([{ x: 1 }]);
  });

  it("skips blank lines", async () => {
    const resp = fakeResponse(['{"a":1}\n\n\n{"a":2}\n']);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toHaveLength(2);
  });

  it("returns nothing for empty body", async () => {
    const resp = fakeResponse([""]);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toHaveLength(0);
  });

  it("handles many small chunks (one byte at a time)", async () => {
    const line = '{"type":"audio","data":"abc"}\n';
    const chunks = line.split("").map((c) => c);
    const resp = fakeResponse(chunks);
    const results: unknown[] = [];
    for await (const msg of parseNDJSON(resp)) results.push(msg);
    expect(results).toEqual([{ type: "audio", data: "abc" }]);
  });
});
