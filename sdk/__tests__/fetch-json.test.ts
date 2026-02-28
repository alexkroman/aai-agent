import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { fetchJSON } from "../fetch-json.ts";

describe("fetchJSON", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns parsed JSON on success", async () => {
    const mockFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ name: "test" }), { status: 200 }),
      );
    const result = await fetchJSON(
      mockFetch as typeof globalThis.fetch,
      "https://example.com",
    );
    expect(result).toEqual({ name: "test" });
  });

  it("returns error object on non-OK response", async () => {
    const mockFetch = () =>
      Promise.resolve(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      );
    const result = await fetchJSON(
      mockFetch as typeof globalThis.fetch,
      "https://example.com/missing",
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("404");
    expect((result as { error: string }).error).toContain("Not Found");
  });

  it("returns error for non-JSON response body", async () => {
    const mockFetch = () =>
      Promise.resolve(new Response("not json at all", { status: 200 }));
    const result = await fetchJSON(
      mockFetch as typeof globalThis.fetch,
      "https://example.com",
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Invalid JSON");
  });

  it("returns error for empty response body", async () => {
    const mockFetch = () => Promise.resolve(new Response("", { status: 200 }));
    const result = await fetchJSON(
      mockFetch as typeof globalThis.fetch,
      "https://example.com",
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Invalid JSON");
  });

  it("passes init options to fetch", async () => {
    let capturedInit: RequestInit | undefined;
    const mockFetch = (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    };
    await fetchJSON(
      mockFetch as typeof globalThis.fetch,
      "https://example.com",
      {
        headers: { "X-Custom": "value" },
      },
    );
    expect(capturedInit).toBeDefined();
    expect((capturedInit!.headers as Record<string, string>)["X-Custom"]).toBe(
      "value",
    );
  });
});
