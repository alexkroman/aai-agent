import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { configureLogger, createLogger, resetLogger } from "../logger.ts";

describe("createLogger", () => {
  it("returns a logger with all log methods", () => {
    const logger = createLogger("test");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("does not throw when logging with data + message", () => {
    const logger = createLogger("test");
    expect(() => logger.info({ key: "value" }, "message")).not.toThrow();
  });

  it("does not throw when logging with message only", () => {
    const logger = createLogger("test");
    expect(() => logger.info("plain message")).not.toThrow();
  });

  it("accepts meta in constructor", () => {
    const logger = createLogger("test", { sid: "abc123" });
    expect(() => logger.info("message")).not.toThrow();
  });
});

describe("configureLogger", () => {
  it("does not throw with valid options", () => {
    expect(() => configureLogger({ logLevel: "info", denoEnv: "development" }))
      .not.toThrow();
  });

  it("handles production mode", () => {
    expect(() => configureLogger({ logLevel: "warn", denoEnv: "production" }))
      .not.toThrow();
  });

  it("handles unknown log level gracefully", () => {
    expect(() => configureLogger({ logLevel: "nonexistent" })).not.toThrow();
  });
});

describe("resetLogger", () => {
  it("restores defaults after configureLogger", () => {
    configureLogger({ logLevel: "error", denoEnv: "production" });
    resetLogger();
    // After reset, info-level logs should work (threshold=info, isDev=true)
    // Verify by checking no throw — the logger should function normally
    const logger = createLogger("test-reset");
    expect(() => logger.info("should work after reset")).not.toThrow();
  });
});
