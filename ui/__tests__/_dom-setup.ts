// _dom-setup.ts — Sets up deno-dom as the global document for Preact component tests.
//
// deno-dom provides DOM parsing but lacks CSSStyleDeclaration and scrollIntoView.
// We patch those onto Element.prototype so Preact's inline style diffing works.

import { DOMParser, Element as DOMElement } from "@b-fuze/deno-dom";
import { signal } from "@preact/signals";
import type { SessionSignals } from "../signals.ts";
import type { AgentState, Message } from "../types.ts";

const HTML = `<!DOCTYPE html><html><body><div id="app"></div></body></html>`;

// ── Style shim ──────────────────────────────────────────────────

function createStyleProxy() {
  const store = new Map<string, string>();
  return new Proxy(
    {} as Record<string, string | ((...a: string[]) => string)>,
    {
      get(_target, prop) {
        if (prop === "setProperty") {
          return (n: string, v: string) => store.set(n, v);
        }
        if (prop === "getPropertyValue") {
          return (n: string) => store.get(n) ?? "";
        }
        if (prop === "removeProperty") {
          return (n: string) => {
            store.delete(n);
            return "";
          };
        }
        if (prop === "cssText") return "";
        if (typeof prop === "string") return store.get(prop) ?? "";
        return undefined;
      },
      set(_target, prop, value) {
        if (typeof prop === "string") store.set(prop, value ?? "");
        return true;
      },
    },
  );
}

// Patch Element.prototype.style (once)
if (!Object.getOwnPropertyDescriptor(DOMElement.prototype, "style")) {
  const styleMap = new WeakMap<
    DOMElement,
    ReturnType<typeof createStyleProxy>
  >();
  Object.defineProperty(DOMElement.prototype, "style", {
    get() {
      let s = styleMap.get(this);
      if (!s) {
        s = createStyleProxy();
        styleMap.set(this, s);
      }
      return s;
    },
    configurable: true,
  });
}

// Patch scrollIntoView (noop in test env)
if (!DOMElement.prototype.scrollIntoView) {
  DOMElement.prototype.scrollIntoView = function () {};
}

// ── Public helpers ──────────────────────────────────────────────

/** Create a fresh deno-dom document and patch globalThis.document. */
export function setupDOM() {
  const doc = new DOMParser().parseFromString(HTML, "text/html")!;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

/** Get the #app container from the current document. */
export function getContainer(): Element {
  return globalThis.document.querySelector("#app")!;
}

/** Create mock SessionSignals with controllable values. */
export function createMockSignals(
  overrides?: Partial<{
    state: AgentState;
    messages: Message[];
    transcript: string;
    error: string;
    started: boolean;
    running: boolean;
  }>,
): SessionSignals & {
  startCalls: number;
  toggleCalls: number;
  resetCalls: number;
} {
  const tracker = { startCalls: 0, toggleCalls: 0, resetCalls: 0 };

  const signals = {
    state: signal<AgentState>(overrides?.state ?? "connecting"),
    messages: signal<Message[]>(overrides?.messages ?? []),
    transcript: signal<string>(overrides?.transcript ?? ""),
    error: signal<string>(overrides?.error ?? ""),
    started: signal<boolean>(overrides?.started ?? false),
    running: signal<boolean>(overrides?.running ?? true),
    start() {
      tracker.startCalls++;
      signals.started.value = true;
      signals.running.value = true;
    },
    toggle() {
      tracker.toggleCalls++;
      signals.running.value = !signals.running.value;
    },
    reset() {
      tracker.resetCalls++;
    },
    ...tracker,
  };

  return signals;
}
