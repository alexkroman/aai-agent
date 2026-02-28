// Tests for mount() using deno-dom.

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { installMockWebSocket, setupDOM } from "./_test_utils.ts";
import { mount } from "./mount.tsx";
import { defaultTheme } from "./theme.ts";

// Preact schedules effects via setTimeout; disable Deno's timer leak detection.
describe("mount()", { sanitizeOps: false, sanitizeResources: false }, () => {
  let restoreWebSocket: () => void;

  beforeEach(() => {
    setupDOM();
    restoreWebSocket = installMockWebSocket();
  });

  afterEach(() => {
    restoreWebSocket();
  });

  it("throws when target selector does not match", () => {
    function App() {
      return <div>test</div>;
    }
    expect(() => mount(App, { target: "#nonexistent" })).toThrow(
      "Element not found: #nonexistent",
    );
  });

  it("renders a component into the default #app element", () => {
    function App() {
      return <div class="hello">Hello Mount</div>;
    }
    mount(App, { platformUrl: "http://localhost:3000" });

    const el = globalThis.document.querySelector("#app")!;
    expect(el.textContent).toContain("Hello Mount");
  });

  it("returns session, signals, and dispose", () => {
    function App() {
      return <div />;
    }
    const handle = mount(App, { platformUrl: "http://localhost:3000" });

    expect(handle.session).toBeDefined();
    expect(handle.signals).toBeDefined();
    expect(typeof handle.dispose).toBe("function");
  });

  it("applies theme CSS variables to the container", () => {
    function App() {
      return <div />;
    }
    mount(App, { platformUrl: "http://localhost:3000" });

    const el = globalThis.document.querySelector("#app") as HTMLElement;
    // deno-lint-ignore no-explicit-any
    const bg = (el.style as any).getPropertyValue("--aai-bg");
    expect(bg).toBe(defaultTheme.bg);
    // deno-lint-ignore no-explicit-any
    const primary = (el.style as any).getPropertyValue("--aai-primary");
    expect(primary).toBe(defaultTheme.primary);
  });

  it("merges custom theme with defaults", () => {
    function App() {
      return <div />;
    }
    mount(App, {
      platformUrl: "http://localhost:3000",
      theme: { bg: "#000000", primary: "#ff0000" },
    });

    const el = globalThis.document.querySelector("#app") as HTMLElement;
    // deno-lint-ignore no-explicit-any
    const bg = (el.style as any).getPropertyValue("--aai-bg");
    expect(bg).toBe("#000000");
    // deno-lint-ignore no-explicit-any
    const primary = (el.style as any).getPropertyValue("--aai-primary");
    expect(primary).toBe("#ff0000");
    // deno-lint-ignore no-explicit-any
    const surface = (el.style as any).getPropertyValue("--aai-surface");
    expect(surface).toBe(defaultTheme.surface);
  });

  it("dispose tears down render and disconnects session", () => {
    function App() {
      return <div>content</div>;
    }
    const handle = mount(App, { platformUrl: "http://localhost:3000" });

    const el = globalThis.document.querySelector("#app")!;
    expect(el.textContent).toContain("content");

    handle.dispose();
    expect(el.textContent).toBe("");
  });
});
