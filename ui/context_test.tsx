// context.test.tsx — Tests for SessionProvider and useSession using deno-dom.

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { render } from "preact";
import { createMockSignals, getContainer, setupDOM } from "./_dom_setup.ts";
import { SessionProvider, useSession } from "./context.tsx";

let container: Element;

// Preact schedules effects via setTimeout; disable Deno's timer leak detection.
describe("SessionProvider + useSession", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeEach(() => {
    setupDOM();
    container = getContainer();
  });

  afterEach(() => {
    render(null, container);
  });
  it("provides signals to child components", () => {
    const signals = createMockSignals({ state: "listening" });

    function Child() {
      const s = useSession();
      return <div>{s.state.value}</div>;
    }

    render(
      <SessionProvider value={signals}>
        <Child />
      </SessionProvider>,
      container,
    );

    expect(container.textContent).toBe("listening");
  });

  it("provides all signal properties", () => {
    const signals = createMockSignals({
      state: "ready",
      transcript: "hello",
      error: "oops",
      started: true,
      running: false,
    });

    let captured: ReturnType<typeof useSession> | null = null;

    function Inspector() {
      captured = useSession();
      return <div>ok</div>;
    }

    render(
      <SessionProvider value={signals}>
        <Inspector />
      </SessionProvider>,
      container,
    );

    expect(captured).not.toBeNull();
    expect(captured!.state.value).toBe("ready");
    expect(captured!.transcript.value).toBe("hello");
    expect(captured!.error.value).toBe("oops");
    expect(captured!.started.value).toBe(true);
    expect(captured!.running.value).toBe(false);
  });

  it("provides start, toggle, and reset methods", () => {
    const signals = createMockSignals();

    let captured: ReturnType<typeof useSession> | null = null;

    function Inspector() {
      captured = useSession();
      return <div>ok</div>;
    }

    render(
      <SessionProvider value={signals}>
        <Inspector />
      </SessionProvider>,
      container,
    );

    expect(typeof captured!.start).toBe("function");
    expect(typeof captured!.toggle).toBe("function");
    expect(typeof captured!.reset).toBe("function");
  });

  it("throws when useSession is called outside SessionProvider", () => {
    function Orphan() {
      useSession();
      return <div>should not render</div>;
    }

    let caught: Error | null = null;
    try {
      render(<Orphan />, container);
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain(
      "useSession() requires <SessionProvider>",
    );
  });
});
