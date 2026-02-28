// tool-executor.ts — Tool execution types and timeout utility.

import { z } from "zod";

/** A registered tool handler with its Zod schema. */
export interface ToolHandler {
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

/** Context provided to tool handlers at execution time. */
export interface ToolContext {
  /** Environment secrets available to the tool. */
  secrets: Record<string, string>;
  /** Sandboxed fetch function. */
  fetch: typeof globalThis.fetch;
  /** Abort signal for cancellation and timeouts. */
  signal?: AbortSignal;
}

/** Race a promise against AbortSignal.timeout(). */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  _message?: string,
): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
    promise.then(resolve, reject);
  });
}
