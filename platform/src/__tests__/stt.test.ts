import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSttToken } from "../stt.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSttToken", () => {
  it("calls the correct URL with API key header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "test-token-abc" }),
    });

    await createSttToken("my-api-key", 480);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url.toString()).toContain("streaming.assemblyai.com/v3/token");
    expect(url.toString()).toContain("expires_in_seconds=480");
    expect(opts.headers.Authorization).toBe("my-api-key");
  });

  it("returns the token from the response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "ephemeral-token-xyz" }),
    });

    const token = await createSttToken("key", 300);
    expect(token).toBe("ephemeral-token-xyz");
  });

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(createSttToken("bad-key", 480)).rejects.toThrow(
      "STT token request failed: 403 Forbidden"
    );
  });

  it("passes custom expiration time", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "t" }),
    });

    await createSttToken("key", 120);

    const url = mockFetch.mock.calls[0][0].toString();
    expect(url).toContain("expires_in_seconds=120");
  });
});
