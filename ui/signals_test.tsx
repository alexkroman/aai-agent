import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { render } from "preact";
import {
  flush,
  getContainer,
  installMockLocation,
  installMockWebSocket,
  setupDOM,
} from "./_test_utils.ts";
import { createSessionSignals, useSession } from "./signals.tsx";
import { VoiceSession } from "./session.ts";

function setup(mock: ReturnType<typeof installMockWebSocket>) {
  const session = new VoiceSession({ platformUrl: "http://localhost:3000" });
  const signals = createSessionSignals(session);
  return {
    session,
    signals,
    async connect() {
      session.connect();
      await flush();
    },
    send(msg: Record<string, unknown>) {
      mock.lastWs!.simulateMessage(JSON.stringify(msg));
    },
  };
}

describe("createSessionSignals", () => {
  let mock: ReturnType<typeof installMockWebSocket>;
  let loc: ReturnType<typeof installMockLocation>;

  beforeEach(() => {
    mock = installMockWebSocket();
    loc = installMockLocation();
  });

  afterEach(() => {
    mock.restore();
    loc.restore();
  });

  it("has correct defaults", () => {
    const { signals } = setup(mock);

    expect(signals.state.value).toBe("connecting");
    expect(signals.messages.value).toEqual([]);
    expect(signals.transcript.value).toBe("");
    expect(signals.error.value).toBe("");
    expect(signals.started.value).toBe(false);
    expect(signals.running.value).toBe(true);
  });

  it("updates state on stateChange", async () => {
    const { signals, connect, session } = setup(mock);
    await connect();
    expect(signals.state.value).toBe("ready");
    session.disconnect();
  });

  it("appends messages", async () => {
    const { signals, connect, send, session } = setup(mock);
    await connect();

    send({ type: "greeting", text: "Hello!" });
    expect(signals.messages.value).toHaveLength(1);
    expect(signals.messages.value[0].role).toBe("assistant");
    expect(signals.messages.value[0].text).toBe("Hello!");

    send({ type: "chat", text: "World", steps: [] });
    expect(signals.messages.value).toHaveLength(2);
    expect(signals.messages.value[1].text).toBe("World");
    session.disconnect();
  });

  it("updates transcript", async () => {
    const { signals, connect, send, session } = setup(mock);
    await connect();

    send({ type: "transcript", text: "hello world" });
    expect(signals.transcript.value).toBe("hello world");
    session.disconnect();
  });

  it("updates error", async () => {
    const { signals, connect, send, session } = setup(mock);
    await connect();

    send({ type: "error", message: "Server error" });
    expect(signals.error.value).toBe("Server error");
    session.disconnect();
  });

  it("sets running to false on error state", async () => {
    const { signals, connect, send, session } = setup(mock);
    await connect();

    expect(signals.running.value).toBe(true);
    send({ type: "error", message: "fatal" });
    expect(signals.running.value).toBe(false);
    session.disconnect();
  });

  it("clears state on reset", async () => {
    const { signals, connect, send, session } = setup(mock);
    await connect();

    send({ type: "greeting", text: "Hi" });
    send({ type: "transcript", text: "partial" });
    send({ type: "error", message: "oops" });
    expect(signals.messages.value).toHaveLength(1);

    send({ type: "reset" });
    expect(signals.messages.value).toEqual([]);
    expect(signals.transcript.value).toBe("");
    expect(signals.error.value).toBe("");
    session.disconnect();
  });

  it("start() sets started/running and connects", async () => {
    const { signals, session } = setup(mock);

    expect(signals.started.value).toBe(false);
    signals.start();
    await flush();

    expect(signals.started.value).toBe(true);
    expect(signals.running.value).toBe(true);
    expect(mock.lastWs).not.toBeNull();
    session.disconnect();
  });

  it("toggle() disconnects then reconnects", async () => {
    const { signals, session } = setup(mock);
    signals.start();
    await flush();

    signals.toggle();
    expect(signals.running.value).toBe(false);

    signals.toggle();
    await flush();
    expect(signals.running.value).toBe(true);
    session.disconnect();
  });

  it("reset() sends reset message", async () => {
    const { signals, connect, session } = setup(mock);
    await connect();

    const before = mock.lastWs!.sent.length;
    signals.reset();

    const sent = mock.lastWs!.sent.slice(before)
      .filter((d): d is string => typeof d === "string");
    expect(sent.some((s) => JSON.parse(s).type === "reset")).toBe(true);
    session.disconnect();
  });
});

describe("useSession", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("throws outside SessionProvider", () => {
    setupDOM();
    const container = getContainer();

    function Orphan() {
      useSession();
      return <div />;
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

    render(null, container);
  });
});
