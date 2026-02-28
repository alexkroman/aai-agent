import "./_dom_shim.ts";
import { DOMParser } from "@b-fuze/deno-dom";
import { signal } from "@preact/signals";
import type { SessionSignals } from "./signals.tsx";
import type { AgentState, Message } from "./types.ts";

const HTML =
  `<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>`;

export function setupDOM() {
  const doc = new DOMParser().parseFromString(HTML, "text/html")!;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

export function getContainer(): Element {
  return globalThis.document.querySelector("#app")!;
}

// Ensure document exists at import time for modules using goober css``.
setupDOM();

export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = "arraybuffer";
  sent: (string | ArrayBuffer | Uint8Array)[] = [];

  constructor(
    public url: string | URL,
    _protocols?: string | string[],
  ) {
    super();
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000 }));
  }

  simulateMessage(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

export function installMockWebSocket(): {
  restore(): void;
  get lastWs(): MockWebSocket | null;
} {
  const saved = globalThis.WebSocket;
  let last: MockWebSocket | null = null;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      last = this;
    }
  };
  return {
    restore() {
      globalThis.WebSocket = saved;
    },
    get lastWs() {
      return last;
    },
  };
}

export const flush = () => new Promise<void>((r) => queueMicrotask(r));

export function installMockLocation(origin = "http://localhost:3000") {
  const had = "location" in globalThis;
  // deno-lint-ignore no-explicit-any
  if (!had) (globalThis as any).location = { origin };
  return {
    restore() {
      // deno-lint-ignore no-explicit-any
      if (!had) delete (globalThis as any).location;
    },
  };
}

export function createMockSignals(
  overrides?: Partial<{
    state: AgentState;
    messages: Message[];
    transcript: string;
    error: string;
    started: boolean;
    running: boolean;
  }>,
): SessionSignals {
  const signals: SessionSignals = {
    state: signal<AgentState>(overrides?.state ?? "connecting"),
    messages: signal<Message[]>(overrides?.messages ?? []),
    transcript: signal<string>(overrides?.transcript ?? ""),
    error: signal<string>(overrides?.error ?? ""),
    started: signal<boolean>(overrides?.started ?? false),
    running: signal<boolean>(overrides?.running ?? true),
    start() {
      signals.started.value = true;
      signals.running.value = true;
    },
    toggle() {
      signals.running.value = !signals.running.value;
    },
    reset() {},
  };

  return signals;
}
