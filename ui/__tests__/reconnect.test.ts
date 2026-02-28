import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { ReconnectStrategy } from "../reconnect.ts";

describe("ReconnectStrategy", () => {
  let fakeTime: FakeTime;

  beforeEach(() => {
    fakeTime = new FakeTime();
  });

  afterEach(() => {
    fakeTime.restore();
  });

  it("canRetry is true initially", () => {
    const strategy = new ReconnectStrategy();
    expect(strategy.canRetry).toBe(true);
  });

  it("canRetry is false after max attempts", () => {
    const max = 3;
    const strategy = new ReconnectStrategy(max);
    const cb = () => {};
    for (let i = 0; i < max; i++) {
      strategy.schedule(cb);
    }
    expect(strategy.canRetry).toBe(false);
  });

  it("schedule returns true when attempts available", () => {
    const strategy = new ReconnectStrategy(5);
    const result = strategy.schedule(() => {});
    expect(result).toBe(true);
  });

  it("schedule returns false when attempts exhausted", () => {
    const strategy = new ReconnectStrategy(1);
    strategy.schedule(() => {});
    const result = strategy.schedule(() => {});
    expect(result).toBe(false);
  });

  it("schedule calls callback after delay", () => {
    const strategy = new ReconnectStrategy(5, 16_000, 1_000);
    let called = false;
    strategy.schedule(() => {
      called = true;
    });
    expect(called).toBe(false);
    fakeTime.tick(1_000);
    expect(called).toBe(true);
  });

  it("applies exponential backoff", () => {
    const strategy = new ReconnectStrategy(5, 16_000, 1_000);
    const calls: number[] = [];
    // First attempt: delay = 1000 * 2^0 = 1000ms
    strategy.schedule(() => {
      calls.push(1);
    });
    fakeTime.tick(1_000);
    expect(calls).toEqual([1]);

    // Second attempt: delay = 1000 * 2^1 = 2000ms
    strategy.schedule(() => {
      calls.push(2);
    });
    fakeTime.tick(1_999);
    expect(calls).toEqual([1]);
    fakeTime.tick(1);
    expect(calls).toEqual([1, 2]);

    // Third attempt: delay = 1000 * 2^2 = 4000ms
    strategy.schedule(() => {
      calls.push(3);
    });
    fakeTime.tick(4_000);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("caps backoff at maxBackoff", () => {
    const strategy = new ReconnectStrategy(10, 2_000, 1_000);
    // First: 1000ms, second: 2000ms, third: should cap at 2000ms
    strategy.schedule(() => {});
    fakeTime.tick(1_000);
    strategy.schedule(() => {});
    fakeTime.tick(2_000);

    let called = false;
    strategy.schedule(() => {
      called = true;
    });
    // Third attempt delay = min(1000 * 2^2 = 4000, 2000) = 2000
    fakeTime.tick(1_999);
    expect(called).toBe(false);
    fakeTime.tick(1);
    expect(called).toBe(true);
  });

  it("cancel clears pending timer", () => {
    const strategy = new ReconnectStrategy(5, 16_000, 1_000);
    let called = false;
    strategy.schedule(() => {
      called = true;
    });
    strategy.cancel();
    fakeTime.tick(10_000);
    expect(called).toBe(false);
  });

  it("reset resets attempt counter", () => {
    const strategy = new ReconnectStrategy(2);
    strategy.schedule(() => {});
    strategy.schedule(() => {});
    expect(strategy.canRetry).toBe(false);

    strategy.reset();
    expect(strategy.canRetry).toBe(true);
  });
});
