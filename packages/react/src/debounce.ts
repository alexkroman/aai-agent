export interface DebouncedFn {
  (): void;
  cancel: () => void;
}

/**
 * Create a debounced version of `fn` that waits `ms` before executing.
 * Repeated calls reset the timer. Call `.cancel()` to prevent execution.
 */
export function debounce(fn: () => void, ms: number): DebouncedFn {
  let id: ReturnType<typeof setTimeout> | undefined;
  return Object.assign(
    () => {
      clearTimeout(id);
      id = setTimeout(fn, ms);
    },
    { cancel: () => clearTimeout(id) },
  );
}
