// _mocks.ts — Shared mock classes for tests.

import { EventEmitter } from "events";
import { vi } from "vitest";

/**
 * Mock WebSocket that auto-opens via queueMicrotask.
 * Use `createWsTracker()` to capture all instances created.
 */
export class MockWS extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 1;
  sent: unknown[] = [];
  url: string;
  opts: unknown;

  constructor(url: string, opts?: unknown) {
    super();
    this.url = url;
    this.opts = opts;
    queueMicrotask(() => this.emit("open"));
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  removeAllListeners() {
    super.removeAllListeners();
    return this;
  }
}

/** Track all MockWS instances created. Call `.reset()` between tests. */
export function createWsTracker() {
  const instances: MockWS[] = [];

  return {
    instances,
    /** Get the most recent instance */
    last() {
      return instances[instances.length - 1];
    },
    /** Clear instance list */
    reset() {
      instances.length = 0;
    },
    /** Factory that creates a MockWS and tracks it */
    create(url: string, opts?: unknown): MockWS {
      const ws = new MockWS(url, opts);
      instances.push(ws);
      return ws;
    },
  };
}

/**
 * Create a mock browser WebSocket (the WS the server sends messages to).
 */
export function makeBrowserWs() {
  const ws = new EventEmitter() as EventEmitter & {
    OPEN: number;
    readyState: number;
    sent: unknown[];
    send: ReturnType<typeof vi.fn>;
  };
  ws.OPEN = 1;
  ws.readyState = 1;
  ws.sent = [];
  ws.send = vi.fn((data: unknown) => ws.sent.push(data));
  return ws;
}

/** Extract JSON messages from a mock browser WS's sent buffer. */
export function getJsonMessages(ws: ReturnType<typeof makeBrowserWs>): Record<string, unknown>[] {
  return ws.sent.filter((d) => typeof d === "string").map((d) => JSON.parse(d as string));
}
