// Shared test helpers for agent tool handler tests.

import type { ToolContext } from "./agent_types.ts";

/** Build a ToolContext, optionally with a custom fetch. */
export function testCtx(fetch?: typeof globalThis.fetch): ToolContext {
  return { secrets: {}, fetch: fetch ?? globalThis.fetch };
}

/** Fetch stub that always returns the same JSON data regardless of URL. */
export function stubFetchJson(data: unknown): typeof globalThis.fetch {
  return (() => Promise.resolve(Response.json(data))) as typeof fetch;
}

/** Fetch stub that always returns an HTTP error. */
export function stubFetchError(
  status: number,
  body: string,
): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(new Response(body, { status }))) as typeof fetch;
}

/** Route-based fetch stub — matches on URL substrings, order-independent. */
export function stubFetch(
  stubs: Record<string, unknown>,
): typeof globalThis.fetch {
  return ((input: string | URL) => {
    const url = String(input);
    const match = Object.entries(stubs).find(([k]) => url.includes(k));
    if (!match) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(Response.json(match[1]));
  }) as typeof fetch;
}
