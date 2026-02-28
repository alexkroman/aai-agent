// tool-executor.ts — Tool execution interfaces and timeout utility.
//
// User-facing types used by agent tool handlers and the platform executor.

import { z } from "zod";

export interface ToolHandler {
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

export interface ToolContext {
  secrets: Record<string, string>;
  fetch: typeof globalThis.fetch;
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

/** Interface for tool execution — satisfied by ToolExecutor and WorkerToolExecutor. */
export interface IToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<string>;
  dispose(): void;
}
