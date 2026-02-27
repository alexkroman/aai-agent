import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadSecretsFile } from "../secrets.js";

describe("loadSecretsFile", () => {
  let tempDir: string;
  const files: string[] = [];

  function writeTemp(name: string, content: string): string {
    if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), "secrets-test-"));
    const path = join(tempDir, name);
    writeFileSync(path, content);
    files.push(path);
    return path;
  }

  afterEach(() => {
    for (const f of files) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
    files.length = 0;
  });

  it("loads per-customer secrets from JSON file", () => {
    const path = writeTemp(
      "secrets.json",
      JSON.stringify({
        pk_customer_abc: { WEATHER_KEY: "sk-abc", DB_KEY: "xyz" },
        pk_customer_def: { STRIPE_KEY: "sk-123" },
      })
    );

    const store = loadSecretsFile(path);

    expect(store.size).toBe(2);
    expect(store.get("pk_customer_abc")).toEqual({ WEATHER_KEY: "sk-abc", DB_KEY: "xyz" });
    expect(store.get("pk_customer_def")).toEqual({ STRIPE_KEY: "sk-123" });
  });

  it("returns empty map for empty JSON object", () => {
    const path = writeTemp("empty.json", "{}");
    const store = loadSecretsFile(path);
    expect(store.size).toBe(0);
  });

  it("returns undefined for unknown API key", () => {
    const path = writeTemp("secrets.json", JSON.stringify({ pk_known: { KEY: "val" } }));
    const store = loadSecretsFile(path);
    expect(store.get("pk_unknown")).toBeUndefined();
  });

  it("throws on invalid JSON", () => {
    const path = writeTemp("bad.json", "not json {{{");
    expect(() => loadSecretsFile(path)).toThrow();
  });

  it("throws on missing file", () => {
    expect(() => loadSecretsFile("/nonexistent/secrets.json")).toThrow();
  });

  it("handles single customer", () => {
    const path = writeTemp("single.json", JSON.stringify({ pk_only: { TOKEN: "t-123" } }));
    const store = loadSecretsFile(path);
    expect(store.size).toBe(1);
    expect(store.get("pk_only")).toEqual({ TOKEN: "t-123" });
  });
});
