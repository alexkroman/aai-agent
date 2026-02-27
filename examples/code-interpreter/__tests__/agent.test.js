import { describe, test, expect } from "vitest";
import { capturedConfig } from "../../__tests__/_mock-client.js";

await import("../agent.js");
const { run_code } = capturedConfig.tools;
const handler = run_code.handler;

describe("code-interpreter — run_code", () => {
  test("evaluates an expression and returns the result", async () => {
    const result = await handler({ code: "return 2 + 3" });
    expect(result).toBe("5");
  });

  test("captures print() output", async () => {
    const result = await handler({ code: 'print("hello"); print("world")' });
    expect(result).toBe("hello\nworld");
  });

  test("returns both output and result when both exist", async () => {
    const result = await handler({
      code: 'print("log"); return 42',
    });
    expect(result).toEqual({ output: "log", result: "42" });
  });

  test("returns message when code produces no output", async () => {
    const result = await handler({ code: "const x = 1" });
    expect(result).toBe("Code ran successfully (no output)");
  });

  test("JSON-stringifies object results", async () => {
    const result = await handler({ code: 'return { a: 1, b: "two" }' });
    expect(JSON.parse(result)).toEqual({ a: 1, b: "two" });
  });

  test("print() stringifies objects", async () => {
    const result = await handler({ code: "print({ x: 1 })" });
    expect(result).toBe('{"x":1}');
  });

  test("returns error on syntax error", async () => {
    const result = await handler({ code: "if (" });
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/Unexpected/);
  });

  test("returns error with partial output on runtime error", async () => {
    const result = await handler({
      code: 'print("before"); throw new Error("boom")',
    });
    expect(result).toEqual({ error: "boom", output: "before" });
  });
});
