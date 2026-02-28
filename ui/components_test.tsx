// Browser-level component tests using deno-dom + Preact.

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { render } from "preact";
import { createMockSignals, getContainer, setupDOM } from "./_test_utils.ts";
import { SessionProvider } from "./signals.tsx";
import {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  Transcript,
} from "./components.tsx";
import type { SessionSignals } from "./signals.tsx";
import type { Message } from "./types.ts";

// ── Helpers ──────────────────────────────────────────────────────

let container: Element;

function renderWithProvider(
  vnode: preact.ComponentChildren,
  signals: SessionSignals,
) {
  render(
    <SessionProvider value={signals}>{vnode}</SessionProvider>,
    container,
  );
}

// Preact schedules effects via setTimeout; disable Deno's timer leak detection.
describe(
  "ui components",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    beforeEach(() => {
      setupDOM();
      container = getContainer();
    });

    afterEach(() => {
      render(null, container);
    });

    // ── StateIndicator ──────────────────────────────────────────

    describe("StateIndicator", () => {
      it("renders the state label", () => {
        render(<StateIndicator state="listening" />, container);
        expect(container.textContent).toContain("listening");
      });
    });

    // ── ErrorBanner ─────────────────────────────────────────────

    describe("ErrorBanner", () => {
      it("renders error message", () => {
        render(<ErrorBanner error="Connection lost" />, container);
        expect(container.textContent).toContain("Connection lost");
      });

      it("renders nothing when empty", () => {
        render(<ErrorBanner error="" />, container);
        expect(container.innerHTML).toBe("");
      });
    });

    // ── MessageBubble ───────────────────────────────────────────

    describe("MessageBubble", () => {
      it("renders message text", () => {
        const msg: Message = { role: "user", text: "Hello there" };
        render(<MessageBubble message={msg} />, container);
        expect(container.textContent).toContain("Hello there");
      });

      it("renders steps when present", () => {
        const msg: Message = {
          role: "assistant",
          text: "Done",
          steps: ["search", "analyze", "respond"],
        };
        render(<MessageBubble message={msg} />, container);
        expect(container.textContent).toContain("search");
        expect(container.textContent).toContain("\u2192");
        expect(container.textContent).toContain("respond");
      });

      it("omits steps section when steps is empty", () => {
        const msg: Message = {
          role: "assistant",
          text: "Simple reply",
          steps: [],
        };
        render(<MessageBubble message={msg} />, container);
        expect(container.textContent).toBe("Simple reply");
      });
    });

    // ── Transcript ──────────────────────────────────────────────

    describe("Transcript", () => {
      it("renders transcript text", () => {
        render(<Transcript text="hello wor" />, container);
        expect(container.textContent).toContain("hello wor");
      });

      it("renders nothing when empty", () => {
        render(<Transcript text="" />, container);
        expect(container.innerHTML).toBe("");
      });
    });

    // ── App (needs provider) ────────────────────────────────────

    describe("App", () => {
      it("shows start button when not started", () => {
        const signals = createMockSignals({ started: false });
        renderWithProvider(<App />, signals);
        expect(container.querySelector("button")!.textContent).toBe(
          "Start Conversation",
        );
      });

      it("shows ChatView when started", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
        });
        renderWithProvider(<App />, signals);
        expect(container.textContent).toContain("listening");
        expect(container.textContent).toContain("Stop");
      });

      it("transitions from start screen to chat", () => {
        const signals = createMockSignals({ started: false });
        renderWithProvider(<App />, signals);
        expect(container.querySelector("button")!.textContent).toBe(
          "Start Conversation",
        );

        signals.started.value = true;
        signals.state.value = "listening";
        renderWithProvider(<App />, signals);

        expect(container.textContent).toContain("listening");
        expect(container.textContent).not.toContain("Start Conversation");
      });
    });

    // ── ChatView (needs provider) ───────────────────────────────

    describe("ChatView", () => {
      it("renders state and messages", () => {
        const signals = createMockSignals({
          started: true,
          state: "thinking",
          running: true,
          messages: [
            { role: "user", text: "What is AI?" },
            { role: "assistant", text: "AI stands for..." },
          ],
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("thinking");
        expect(container.textContent).toContain("What is AI?");
        expect(container.textContent).toContain("AI stands for...");
      });

      it("renders transcript and error", () => {
        const signals = createMockSignals({
          started: true,
          state: "error",
          running: false,
          transcript: "hello wor",
          error: "Connection failed",
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("hello wor");
        expect(container.textContent).toContain("Connection failed");
      });

      it("shows Stop when running, Resume when not", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
        });
        renderWithProvider(<ChatView />, signals);

        const buttons = () =>
          Array.from(container.querySelectorAll("button")).map((b) =>
            b.textContent
          );

        expect(buttons()).toContain("Stop");
        expect(buttons()).toContain("New Conversation");

        signals.running.value = false;
        renderWithProvider(<ChatView />, signals);
        expect(buttons()).toContain("Resume");
      });

      it("renders messages in order", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
          messages: [
            { role: "user", text: "First" },
            { role: "assistant", text: "Second" },
            { role: "user", text: "Third" },
          ],
        });
        renderWithProvider(<ChatView />, signals);

        const text = container.textContent!;
        expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
        expect(text.indexOf("Second")).toBeLessThan(text.indexOf("Third"));
      });

      it("renders message steps", () => {
        const signals = createMockSignals({
          started: true,
          state: "speaking",
          running: true,
          messages: [
            { role: "assistant", text: "Found it", steps: ["search", "parse"] },
          ],
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("search");
        expect(container.textContent).toContain("\u2192");
        expect(container.textContent).toContain("parse");
      });
    });
  },
);
