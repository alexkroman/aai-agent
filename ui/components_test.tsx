// components.test.tsx — Browser-level component tests using deno-dom + Preact.

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { render } from "preact";
import { createMockSignals, getContainer, setupDOM } from "./_dom_setup.ts";
import { SessionProvider } from "./context.tsx";
import { StateIndicator } from "./components/state_indicator.tsx";
import { ErrorBanner } from "./components/error_banner.tsx";
import { MessageBubble } from "./components/message_bubble.tsx";
import { Transcript } from "./components/transcript.tsx";
import { App } from "./components/app.tsx";
import { ChatView } from "./components/chat_view.tsx";
import type { SessionSignals } from "./signals.ts";
import type { AgentState, Message } from "./types.ts";

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

    // ── StateIndicator ──────────────────────────────────────────────

    describe("StateIndicator", () => {
      const ALL_STATES: AgentState[] = [
        "connecting",
        "ready",
        "listening",
        "thinking",
        "speaking",
        "error",
      ];

      it("renders the state label text", () => {
        const signals = createMockSignals({ state: "listening" });
        renderWithProvider(<StateIndicator state="listening" />, signals);

        expect(container.textContent).toContain("listening");
      });

      for (const state of ALL_STATES) {
        it(`renders "${state}" state`, () => {
          const signals = createMockSignals({ state });
          renderWithProvider(<StateIndicator state={state} />, signals);

          expect(container.textContent).toContain(state);
        });
      }

      it("renders a state dot element", () => {
        const signals = createMockSignals();
        renderWithProvider(<StateIndicator state="ready" />, signals);

        const divs = container.querySelectorAll("div");
        // outer stateRow div > stateDot div + span
        expect(divs.length).toBeGreaterThanOrEqual(2);
      });
    });

    // ── ErrorBanner ─────────────────────────────────────────────────

    describe("ErrorBanner", () => {
      it("renders error message when non-empty", () => {
        const signals = createMockSignals();
        renderWithProvider(
          <ErrorBanner error="Connection lost" />,
          signals,
        );

        expect(container.textContent).toContain("Connection lost");
      });

      it("renders nothing when error is empty", () => {
        const signals = createMockSignals();
        renderWithProvider(<ErrorBanner error="" />, signals);

        expect(container.innerHTML).toBe("");
      });

      it("renders the error in a div", () => {
        const signals = createMockSignals();
        renderWithProvider(
          <ErrorBanner error="Server error" />,
          signals,
        );

        const div = container.querySelector("div");
        expect(div).not.toBeNull();
        expect(div!.textContent).toBe("Server error");
      });
    });

    // ── MessageBubble ───────────────────────────────────────────────

    describe("MessageBubble", () => {
      it("renders message text", () => {
        const msg: Message = { role: "user", text: "Hello there" };
        const signals = createMockSignals();
        renderWithProvider(<MessageBubble message={msg} />, signals);

        expect(container.textContent).toContain("Hello there");
      });

      it("renders assistant message text", () => {
        const msg: Message = {
          role: "assistant",
          text: "Hi! How can I help?",
        };
        const signals = createMockSignals();
        renderWithProvider(<MessageBubble message={msg} />, signals);

        expect(container.textContent).toContain("Hi! How can I help?");
      });

      it("renders steps when present", () => {
        const msg: Message = {
          role: "assistant",
          text: "Done",
          steps: ["search", "analyze", "respond"],
        };
        const signals = createMockSignals();
        renderWithProvider(<MessageBubble message={msg} />, signals);

        expect(container.textContent).toContain("search");
        expect(container.textContent).toContain("→");
        expect(container.textContent).toContain("respond");
      });

      it("does not render steps section when steps is empty", () => {
        const msg: Message = {
          role: "assistant",
          text: "Simple reply",
          steps: [],
        };
        const signals = createMockSignals();
        renderWithProvider(<MessageBubble message={msg} />, signals);

        expect(container.textContent).toBe("Simple reply");
        expect(container.textContent).not.toContain("→");
      });

      it("does not render steps section when steps is undefined", () => {
        const msg: Message = { role: "user", text: "Question" };
        const signals = createMockSignals();
        renderWithProvider(<MessageBubble message={msg} />, signals);

        expect(container.textContent).toBe("Question");
      });
    });

    // ── Transcript ──────────────────────────────────────────────────

    describe("Transcript", () => {
      it("renders transcript text", () => {
        const signals = createMockSignals();
        renderWithProvider(<Transcript text="hello wor" />, signals);

        expect(container.textContent).toContain("hello wor");
      });

      it("renders nothing when text is empty", () => {
        const signals = createMockSignals();
        renderWithProvider(<Transcript text="" />, signals);

        expect(container.innerHTML).toBe("");
      });
    });

    // ── App ─────────────────────────────────────────────────────────

    describe("App", () => {
      it("shows start button when not started", () => {
        const signals = createMockSignals({ started: false });
        renderWithProvider(<App />, signals);

        const button = container.querySelector("button");
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe("Start Conversation");
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
        expect(container.textContent).toContain("New Conversation");
      });

      it("transitions from start screen to chat on button click", () => {
        const signals = createMockSignals({ started: false });
        renderWithProvider(<App />, signals);

        expect(container.querySelector("button")!.textContent).toBe(
          "Start Conversation",
        );

        // Simulate what start() does
        signals.started.value = true;
        signals.state.value = "listening";

        // Re-render to reflect signal changes
        renderWithProvider(<App />, signals);

        expect(container.textContent).toContain("listening");
        expect(container.textContent).not.toContain("Start Conversation");
      });
    });

    // ── ChatView ────────────────────────────────────────────────────

    describe("ChatView", () => {
      it("renders state indicator", () => {
        const signals = createMockSignals({
          started: true,
          state: "thinking",
          running: true,
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("thinking");
      });

      it("renders messages", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
          messages: [
            { role: "user", text: "What is AI?" },
            { role: "assistant", text: "AI stands for..." },
          ],
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("What is AI?");
        expect(container.textContent).toContain("AI stands for...");
      });

      it("renders transcript when present", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
          transcript: "hello wor",
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("hello wor");
      });

      it("renders error banner when error exists", () => {
        const signals = createMockSignals({
          started: true,
          state: "error",
          running: false,
          error: "Connection failed",
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("Connection failed");
      });

      it("does not render error banner when no error", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
          error: "",
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).not.toContain("Connection failed");
      });

      it("shows Stop button when running", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: true,
        });
        renderWithProvider(<ChatView />, signals);

        const buttons = container.querySelectorAll("button");
        const labels = Array.from(buttons).map((b) => b.textContent);
        expect(labels).toContain("Stop");
        expect(labels).toContain("New Conversation");
      });

      it("shows Resume button when not running", () => {
        const signals = createMockSignals({
          started: true,
          state: "listening",
          running: false,
        });
        renderWithProvider(<ChatView />, signals);

        const buttons = container.querySelectorAll("button");
        const labels = Array.from(buttons).map((b) => b.textContent);
        expect(labels).toContain("Resume");
      });

      it("renders multiple messages in order", () => {
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
        const firstIdx = text.indexOf("First");
        const secondIdx = text.indexOf("Second");
        const thirdIdx = text.indexOf("Third");
        expect(firstIdx).toBeLessThan(secondIdx);
        expect(secondIdx).toBeLessThan(thirdIdx);
      });

      it("renders message with steps in ChatView", () => {
        const signals = createMockSignals({
          started: true,
          state: "speaking",
          running: true,
          messages: [
            {
              role: "assistant",
              text: "Found it",
              steps: ["search", "parse"],
            },
          ],
        });
        renderWithProvider(<ChatView />, signals);

        expect(container.textContent).toContain("Found it");
        expect(container.textContent).toContain("search");
        expect(container.textContent).toContain("→");
        expect(container.textContent).toContain("parse");
      });
    });
  },
);
