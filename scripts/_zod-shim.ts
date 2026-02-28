// _zod-shim.ts — Tiny zod stub for worker bundles.
// Agents call z.object(), z.string(), etc. at import time to define tool
// parameters. In the worker, we don't need real schemas (those are
// pre-computed at bundle time), so this shim just returns chainable stubs
// that won't crash. No validation, no JSON Schema conversion.

// deno-lint-ignore no-explicit-any
type Any = any;

const chainable = (): Any =>
  new Proxy(() => {}, {
    get: () => chainable(),
    apply: () => chainable(),
  });

export const z = {
  object: chainable,
  string: chainable,
  number: chainable,
  boolean: chainable,
  array: chainable,
  enum: chainable,
  union: chainable,
  literal: chainable,
  optional: chainable,
  nullable: chainable,
  record: chainable,
  tuple: chainable,
  intersection: chainable,
  lazy: chainable,
  any: chainable,
  unknown: chainable,
  void: chainable,
  never: chainable,
  coerce: chainable(),
  toJSONSchema: () => ({}),
};
