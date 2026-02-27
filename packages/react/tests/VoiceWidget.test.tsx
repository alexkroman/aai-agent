import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Message, VoiceAgentResult } from "../src/types";

// Mock useVoiceAgent so we can control its return values
const mockToggleRecording = vi.fn();
const mockClearMessages = vi.fn();

vi.mock("../src/useVoiceAgent", () => ({
  useVoiceAgent: vi.fn(() => ({
    messages: [],
    error: null,
    phase: "idle",
    turnPhase: "listening",
    toggleRecording: mockToggleRecording,
    clearMessages: mockClearMessages,
  })),
}));

import { VoiceWidget } from "../src/VoiceWidget";
import { useVoiceAgent } from "../src/useVoiceAgent";

const mockedUseVoiceAgent = vi.mocked(useVoiceAgent);

const defaultMock: VoiceAgentResult = {
  messages: [],
  error: null,
  phase: "idle",
  turnPhase: "listening",
  toggleRecording: mockToggleRecording,
  clearMessages: mockClearMessages,
};

function mockMessages(...msgs: Message[]): VoiceAgentResult {
  return { ...defaultMock, messages: msgs, phase: "active" };
}

describe("VoiceWidget", () => {
  it("renders with default title", () => {
    render(<VoiceWidget />);
    expect(screen.getByText("Voice Assistant")).toBeInTheDocument();
  });

  it("renders with custom title", () => {
    render(<VoiceWidget title="My Bot" />);
    expect(screen.getByText("My Bot")).toBeInTheDocument();
  });

  it("renders mic button with aria-label", () => {
    render(<VoiceWidget />);
    const btn = screen.getByRole("button", { name: "Start recording" });
    expect(btn).toBeInTheDocument();
  });

  it("calls toggleRecording on button click", async () => {
    render(<VoiceWidget />);
    const btn = screen.getByRole("button", { name: "Start recording" });
    await userEvent.setup().click(btn);
    expect(mockToggleRecording).toHaveBeenCalledOnce();
  });

  it("shows recording class when active", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
      turnPhase: "listening",
    });

    render(<VoiceWidget />);
    const btn = screen.getByRole("button", { name: "Stop recording" });
    expect(btn.className).toContain("aai-recording");
    expect(btn.className).toContain("aai-mic-listening");
  });

  it("shows pulse ring when listening", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
      turnPhase: "listening",
    });

    const { container } = render(<VoiceWidget />);
    expect(container.querySelector(".aai-pulse-ring")).toBeInTheDocument();
    expect(container.querySelector(".aai-spinner-ring")).not.toBeInTheDocument();
    expect(container.querySelector(".aai-speaking-ring")).not.toBeInTheDocument();
  });

  it("shows spinner ring when processing", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
      turnPhase: "processing",
    });

    const { container } = render(<VoiceWidget />);
    expect(container.querySelector(".aai-spinner-ring")).toBeInTheDocument();
    expect(container.querySelector(".aai-pulse-ring")).not.toBeInTheDocument();
  });

  it("shows speaking ring and speaker icon when speaking", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
      turnPhase: "speaking",
    });

    const { container } = render(<VoiceWidget />);
    expect(container.querySelector(".aai-speaking-ring")).toBeInTheDocument();
    expect(container.querySelector(".aai-mic-speaking")).toBeInTheDocument();
  });

  it("renders messages", () => {
    mockedUseVoiceAgent.mockReturnValue(
      mockMessages(
        { id: "1", text: "Hello", role: "user", type: "message" },
        { id: "2", text: "Hi there", role: "assistant", type: "message" },
      ),
    );

    render(<VoiceWidget />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("renders thinking indicator", () => {
    mockedUseVoiceAgent.mockReturnValue(
      mockMessages(
        { id: "1", text: "", role: "assistant", type: "thinking" },
      ),
    );

    render(<VoiceWidget />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("conversation pane is hidden when idle", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      messages: [{ id: "1", text: "hi", role: "user", type: "message" }],
    });

    const { container } = render(<VoiceWidget />);
    const convo = container.querySelector(".aai-conversation");
    expect(convo!.className).not.toContain("aai-active");
  });

  it("conversation pane is visible when active", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
    });

    const { container } = render(<VoiceWidget />);
    const convo = container.querySelector(".aai-conversation");
    expect(convo!.getAttribute("aria-hidden")).toBe("false");
  });

  it("passes props through to useVoiceAgent", () => {
    mockedUseVoiceAgent.mockReturnValue(defaultMock);

    render(
      <VoiceWidget
        baseUrl="/api"
        maxMessages={50}
      />,
    );

    expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "/api",
        maxMessages: 50,
      }),
    );
  });

  it("has accessible conversation log", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
    });

    const { container } = render(<VoiceWidget />);
    const log = container.querySelector("[role='log']");
    expect(log).toBeInTheDocument();
    expect(log!.getAttribute("aria-live")).toBe("polite");
  });

  it("mic button has aria-pressed when active", () => {
    mockedUseVoiceAgent.mockReturnValue({
      ...defaultMock,
      phase: "active",
      turnPhase: "listening",
    });

    render(<VoiceWidget />);
    const btn = screen.getByRole("button", { name: "Stop recording" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("conversation is aria-hidden when idle", () => {
    mockedUseVoiceAgent.mockReturnValue(defaultMock);

    const { container } = render(<VoiceWidget />);
    const convo = container.querySelector("[role='log']");
    expect(convo!.getAttribute("aria-hidden")).toBe("true");
  });
});
