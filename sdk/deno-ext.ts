// deno-ext.ts — Typed wrappers for Deno-specific API extensions.
//
// Deno 2.5+ supports passing { headers } to WebSocket constructor and
// { deno: { permissions } } to Worker constructor. These extensions aren't
// in the standard lib.dom.d.ts types, so we provide typed helper functions
// that encapsulate a single cast at the boundary.

/** Deno-specific Worker options with permission sandboxing. */
export interface DenoWorkerOptions extends WorkerOptions {
  deno?: {
    permissions?: {
      net?: boolean;
      read?: boolean;
      env?: boolean;
      run?: boolean;
      write?: boolean;
      ffi?: boolean;
    };
  };
}

/**
 * Create a WebSocket with Deno's { headers } option (Deno 2.5+).
 * Single cast point — all downstream usage is fully typed.
 */
export function createDenoWebSocket(
  url: string | URL,
  options: { headers: Record<string, string> },
): WebSocket {
  // deno-lint-ignore no-explicit-any
  return new (WebSocket as any)(url, options);
}

/**
 * Create a Worker with Deno's { deno: { permissions } } option.
 * Single cast point — all downstream usage is fully typed.
 */
export function createDenoWorker(
  specifier: string | URL,
  options: DenoWorkerOptions,
): Worker {
  // deno-lint-ignore no-explicit-any
  return new (Worker as any)(specifier, options);
}
