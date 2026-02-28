// Zod stub for worker bundles. Real schemas are pre-computed at bundle time,
// so this just returns chainable no-ops that won't crash at import time.

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
