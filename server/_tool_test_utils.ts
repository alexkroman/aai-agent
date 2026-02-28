import type { ToolContext } from "./agent_types.ts";

export function testCtx(fetch?: typeof globalThis.fetch): ToolContext {
  return { secrets: {}, fetch: fetch ?? globalThis.fetch };
}

export function stubFetchJson(data: unknown): typeof globalThis.fetch {
  return (() => Promise.resolve(Response.json(data))) as typeof fetch;
}

export function stubFetchError(
  status: number,
  body: string,
): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(new Response(body, { status }))) as typeof fetch;
}

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
