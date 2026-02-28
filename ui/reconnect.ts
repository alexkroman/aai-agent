// Reconnection strategy with exponential backoff.

import {
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RECONNECT_ATTEMPTS,
} from "./types.ts";

export class ReconnectStrategy {
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxAttempts: number;
  private readonly maxBackoff: number;
  private readonly initialBackoff: number;

  constructor(
    maxAttempts = MAX_RECONNECT_ATTEMPTS,
    maxBackoff = MAX_BACKOFF_MS,
    initialBackoff = INITIAL_BACKOFF_MS,
  ) {
    this.maxAttempts = maxAttempts;
    this.maxBackoff = maxBackoff;
    this.initialBackoff = initialBackoff;
  }

  /** Whether another retry attempt is available. */
  get canRetry(): boolean {
    return this.attempts < this.maxAttempts;
  }

  /**
   * Schedule the next reconnect attempt.
   * Returns false if attempts are exhausted.
   */
  schedule(cb: () => void): boolean {
    if (!this.canRetry) return false;
    const delay = Math.min(
      this.initialBackoff * 2 ** this.attempts,
      this.maxBackoff,
    );
    this.attempts++;
    this.timer = setTimeout(() => {
      this.timer = null;
      cb();
    }, delay);
    return true;
  }

  /** Cancel any pending reconnect timer. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Reset attempt counter (call on successful connection). */
  reset(): void {
    this.attempts = 0;
  }
}
