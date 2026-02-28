// fetch-json.ts — Tiny helper to fetch a URL and parse JSON, with error handling.

import type { z } from "zod";

/**
 * Fetch a URL, parse JSON, and validate with a Zod schema.
 * Returns the validated + typed data, or `{ error: string }` on failure.
 */
export async function fetchJSON<T extends z.ZodType>(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit | undefined,
  schema: T,
): Promise<z.infer<T> | { error: string }>;

/**
 * Fetch a URL and parse the JSON response.
 * Returns `{ error: string }` on non-OK status instead of throwing.
 *
 * @example
 * ```ts
 * const data = await fetchJSON(ctx.fetch, `https://api.example.com/data`);
 * if ("error" in data) return data;
 * ```
 */
export async function fetchJSON(
  fetch: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>>;

// Implementation
export async function fetchJSON(
  fetch: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
  schema?: z.ZodType,
): Promise<unknown> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    return { error: `${resp.status} ${resp.statusText}` };
  }
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return { error: "Invalid JSON in response body" };
  }
  if (!schema) return data as Record<string, unknown>;
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: `Response validation failed: ${result.error.message}` };
  }
  return result.data;
}
