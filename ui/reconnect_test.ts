import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { ReconnectStrategy } from "./session.ts";

Deno.test("canRetry true initially, false after max attempts", () => {
  const time = new FakeTime();
  try {
    const s = new ReconnectStrategy(2);
    assertEquals(s.canRetry, true);
    s.schedule(() => {});
    s.schedule(() => {});
    assertEquals(s.canRetry, false);
  } finally {
    time.restore();
  }
});

Deno.test("schedule returns true until exhausted", () => {
  const time = new FakeTime();
  try {
    const s = new ReconnectStrategy(1);
    assertEquals(s.schedule(() => {}), true);
    assertEquals(s.schedule(() => {}), false);
  } finally {
    time.restore();
  }
});

Deno.test("schedule fires callback after delay", () => {
  const time = new FakeTime();
  try {
    const s = new ReconnectStrategy(5, 16_000, 1_000);
    let called = false;
    s.schedule(() => {
      called = true;
    });
    assertEquals(called, false);
    time.tick(1_000);
    assertEquals(called, true);
  } finally {
    time.restore();
  }
});

Deno.test("exponential backoff capped at maxBackoff", () => {
  const time = new FakeTime();
  try {
    const s = new ReconnectStrategy(5, 4_000, 1_000);
    const calls: number[] = [];

    // 1st: 1000 * 2^0 = 1000ms
    s.schedule(() => {
      calls.push(1);
    });
    time.tick(1_000);
    assertEquals(calls, [1]);

    // 2nd: 1000 * 2^1 = 2000ms
    s.schedule(() => {
      calls.push(2);
    });
    time.tick(2_000);
    assertEquals(calls, [1, 2]);

    // 3rd: 1000 * 2^2 = 4000ms (hits cap)
    s.schedule(() => {
      calls.push(3);
    });
    time.tick(3_999);
    assertEquals(calls, [1, 2]);
    time.tick(1);
    assertEquals(calls, [1, 2, 3]);

    // 4th: capped at 4000ms
    s.schedule(() => {
      calls.push(4);
    });
    time.tick(4_000);
    assertEquals(calls, [1, 2, 3, 4]);
  } finally {
    time.restore();
  }
});

Deno.test("cancel clears pending timer", () => {
  const time = new FakeTime();
  try {
    const s = new ReconnectStrategy(5, 16_000, 1_000);
    let called = false;
    s.schedule(() => {
      called = true;
    });
    s.cancel();
    time.tick(10_000);
    assertEquals(called, false);
  } finally {
    time.restore();
  }
});

Deno.test("reset restores retry capacity", () => {
  const time = new FakeTime();
  try {
    const s = new ReconnectStrategy(1);
    s.schedule(() => {});
    assertEquals(s.canRetry, false);
    s.reset();
    assertEquals(s.canRetry, true);
  } finally {
    time.restore();
  }
});
