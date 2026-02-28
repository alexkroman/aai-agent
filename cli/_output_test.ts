import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { log } from "./_output.ts";

describe("log helpers", () => {
  let logSpy: ReturnType<typeof spy>;
  let errorSpy: ReturnType<typeof spy>;

  function spy(target: Console, method: "log" | "error") {
    const calls: string[][] = [];
    const original = target[method].bind(target);
    target[method] = (...args: string[]) => calls.push(args);
    return { calls, restore: () => (target[method] = original) };
  }

  beforeEach(() => {
    logSpy = spy(console, "log");
    errorSpy = spy(console, "error");
  });

  afterEach(() => {
    logSpy.restore();
    errorSpy.restore();
  });

  it("header writes to stdout", () => {
    log.header("Title");
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("Title");
  });

  it("success prefixes with checkmark", () => {
    log.success("done");
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("✓");
    expect(logSpy.calls[0][0]).toContain("done");
  });

  it("info writes to stdout", () => {
    log.info("note");
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("note");
  });

  it("warn writes to stderr", () => {
    log.warn("careful");
    expect(errorSpy.calls.length).toBe(1);
    expect(errorSpy.calls[0][0]).toContain("careful");
  });

  it("error writes to stderr", () => {
    log.error("oops");
    expect(errorSpy.calls.length).toBe(1);
    expect(errorSpy.calls[0][0]).toContain("oops");
  });

  it("agent formats slug", () => {
    log.agent("night-owl");
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("night-owl");
  });

  it("agent formats slug with detail", () => {
    log.agent("night-owl", "ready");
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("night-owl");
    expect(logSpy.calls[0][0]).toContain("ready");
  });

  it("size formats bytes as KB", () => {
    log.size("worker.js", 2048);
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("worker.js");
    expect(logSpy.calls[0][0]).toContain("2.0KB");
  });

  it("timing formats milliseconds", () => {
    log.timing("done", 123.4);
    expect(logSpy.calls.length).toBe(1);
    expect(logSpy.calls[0][0]).toContain("done");
    expect(logSpy.calls[0][0]).toContain("123ms");
  });
});
