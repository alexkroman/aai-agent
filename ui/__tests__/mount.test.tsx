// mount.test.tsx — Tests for mount() using deno-dom.

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { setupDOM } from "./_dom-setup.ts";
import { mount } from "../mount.tsx";
import { defaultTheme } from "../theme.ts";

// ── Mock WebSocket ──────────────────────────────────────────────

class MockClientWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockClientWebSocket.CONNECTING;
  binaryType = "arraybuffer";
  sent: (string | ArrayBuffer | Uint8Array)[] = [];

  constructor(
    public url: string | URL,
    _protocols?: string | string[],
  ) {
    super();
    queueMicrotask(() => {
      this.readyState = MockClientWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = MockClientWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000 }));
  }
}

// ── Tests ───────────────────────────────────────────────────────

// Preact schedules effects via setTimeout; disable Deno's timer leak detection.
describe("mount()", { sanitizeOps: false, sanitizeResources: false }, () => {
  let OriginalWebSocket: typeof WebSocket;

  beforeEach(() => {
    setupDOM();
    OriginalWebSocket = globalThis.WebSocket;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).WebSocket = MockClientWebSocket;
    if (!("location" in globalThis)) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).location = { origin: "http://localhost:3000" };
    }
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  it("throws when element selector does not match", () => {
    function Dummy() {
      return <div>test</div>;
    }
    const agent = mount(Dummy);

    expect(() =>
      agent.start({
        element: "#nonexistent",
        platformUrl: "http://localhost:3000",
      })
    ).toThrow("Element not found: #nonexistent");
  });

  it("renders a component into the target element", () => {
    function Hello() {
      return <div class="hello">Hello Mount</div>;
    }
    const agent = mount(Hello);
    agent.start({ element: "#app", platformUrl: "http://localhost:3000" });

    const el = globalThis.document.querySelector("#app")!;
    expect(el.textContent).toContain("Hello Mount");
  });

  it("returns cancel, reset, and disconnect methods", () => {
    function Dummy() {
      return <div />;
    }
    const agent = mount(Dummy);
    const controls = agent.start({
      element: "#app",
      platformUrl: "http://localhost:3000",
    });

    expect(typeof controls.cancel).toBe("function");
    expect(typeof controls.reset).toBe("function");
    expect(typeof controls.disconnect).toBe("function");
  });

  it("applies theme CSS variables to the container", () => {
    function Dummy() {
      return <div />;
    }
    const agent = mount(Dummy);
    agent.start({ element: "#app", platformUrl: "http://localhost:3000" });

    const el = globalThis.document.querySelector("#app") as HTMLElement;
    // Our style shim captures setProperty calls
    // deno-lint-ignore no-explicit-any
    const bg = (el.style as any).getPropertyValue("--aai-bg");
    expect(bg).toBe(defaultTheme.bg);
    // deno-lint-ignore no-explicit-any
    const primary = (el.style as any).getPropertyValue("--aai-primary");
    expect(primary).toBe(defaultTheme.primary);
  });

  it("merges custom theme with defaults", () => {
    function Dummy() {
      return <div />;
    }
    const customTheme = { bg: "#000000", primary: "#ff0000" };
    const agent = mount(Dummy, { theme: customTheme });
    agent.start({ element: "#app", platformUrl: "http://localhost:3000" });

    const el = globalThis.document.querySelector("#app") as HTMLElement;
    // deno-lint-ignore no-explicit-any
    const bg = (el.style as any).getPropertyValue("--aai-bg");
    expect(bg).toBe("#000000");
    // deno-lint-ignore no-explicit-any
    const primary = (el.style as any).getPropertyValue("--aai-primary");
    expect(primary).toBe("#ff0000");
    // Non-overridden values should use defaults
    // deno-lint-ignore no-explicit-any
    const surface = (el.style as any).getPropertyValue("--aai-surface");
    expect(surface).toBe(defaultTheme.surface);
  });

  it("sets body background to theme bg color", () => {
    function Dummy() {
      return <div />;
    }
    const agent = mount(Dummy);
    agent.start({ element: "#app", platformUrl: "http://localhost:3000" });

    const body = globalThis.document.body as HTMLElement;
    // deno-lint-ignore no-explicit-any
    const bg = (body.style as any).background;
    expect(bg).toBe(defaultTheme.bg);
  });
});
