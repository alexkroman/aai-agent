import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import WebSocket from "ws";

// Use vi.hoisted so mock fns are available inside vi.mock factory
const { mockStart, mockOnAudio, mockOnCancel, mockOnReset, mockStop } = vi.hoisted(() => ({
  mockStart: vi.fn().mockResolvedValue(undefined),
  mockOnAudio: vi.fn(),
  mockOnCancel: vi.fn().mockResolvedValue(undefined),
  mockOnReset: vi.fn().mockResolvedValue(undefined),
  mockStop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../session.js", () => ({
  VoiceSession: class {
    constructor(
      public id: string,
      public ws: unknown,
      public config: unknown
    ) {}
    start = mockStart;
    onAudio = mockOnAudio;
    onCancel = mockOnCancel;
    onReset = mockOnReset;
    stop = mockStop;
  },
}));

import { startServer, type ServerHandle } from "../server.js";

let handle: ServerHandle;
let port: number;
let clientDir: string;

function getPort(h: ServerHandle): number {
  const addr = h.httpServer.address();
  if (typeof addr === "object" && addr) return addr.port;
  throw new Error("Server not listening");
}

beforeEach(() => {
  vi.clearAllMocks();

  clientDir = mkdtempSync(join(tmpdir(), "test-client-"));
  writeFileSync(join(clientDir, "client.js"), "// client bundle");
  writeFileSync(join(clientDir, "react.js"), "// react bundle");

  handle = startServer({ port: 0, clientDir });
  port = getPort(handle);
});

afterEach(async () => {
  await handle.close();
  rmSync(clientDir, { recursive: true, force: true });
});

describe("HTTP routes", () => {
  it("GET /health returns 200 with status ok", async () => {
    const resp = await fetch(`http://localhost:${port}/health`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");

    const body = await resp.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /client.js serves the client bundle", async () => {
    const resp = await fetch(`http://localhost:${port}/client.js`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("application/javascript");
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("max-age=3600");

    const body = await resp.text();
    expect(body).toBe("// client bundle");
  });

  it("GET /react.js serves the react bundle", async () => {
    const resp = await fetch(`http://localhost:${port}/react.js`);
    expect(resp.status).toBe(200);

    const body = await resp.text();
    expect(body).toBe("// react bundle");
  });

  it("GET /nonexistent returns 404", async () => {
    const resp = await fetch(`http://localhost:${port}/nonexistent`);
    expect(resp.status).toBe(404);
  });

  it("OPTIONS returns CORS preflight headers", async () => {
    const resp = await fetch(`http://localhost:${port}/anything`, {
      method: "OPTIONS",
    });
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("returns 404 for client files when no clientDir", async () => {
    const h2 = startServer({ port: 0 });
    const p2 = getPort(h2);

    const resp = await fetch(`http://localhost:${p2}/client.js`);
    expect(resp.status).toBe(404);

    await h2.close();
  });
});

describe("WebSocket /session", () => {
  it("rejects connection without API key", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session`);

    const messages: string[] = [];
    ws.on("message", (data) => messages.push(data.toString()));

    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
    });

    const parsed = JSON.parse(messages[0]);
    expect(parsed).toMatchObject({
      type: "error",
      message: "Missing API key",
    });
  });

  it("requires configure as first message", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    // Set up message listener BEFORE opening so we don't miss messages
    const messages: string[] = [];
    ws.on("message", (data) => messages.push(data.toString()));

    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Send a non-configure message first
    ws.send(JSON.stringify({ type: "cancel" }));

    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));

    const parsed = JSON.parse(messages[0]);
    expect(parsed).toMatchObject({
      type: "error",
      message: "First message must be a valid configure message",
    });

    ws.close();
  });

  it("creates session on valid configure message and calls start()", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(
      JSON.stringify({
        type: "configure",
        instructions: "Be helpful",
        greeting: "Hi!",
        voice: "jess",
        tools: [],
      })
    );

    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledOnce());

    ws.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  it("relays binary audio to session.onAudio", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "configure", tools: [] }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());

    const audio = Buffer.from([1, 2, 3, 4]);
    ws.send(audio);

    await vi.waitFor(() => expect(mockOnAudio).toHaveBeenCalled());

    ws.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  it("handles cancel control message", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "configure", tools: [] }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());

    ws.send(JSON.stringify({ type: "cancel" }));
    await vi.waitFor(() => expect(mockOnCancel).toHaveBeenCalled());

    ws.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  it("handles reset control message", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "configure", tools: [] }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());

    ws.send(JSON.stringify({ type: "reset" }));
    await vi.waitFor(() => expect(mockOnReset).toHaveBeenCalled());

    ws.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  it("calls session.stop() on disconnect", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "configure", tools: [] }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());

    ws.close();
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalled());
  });

  it("ignores invalid JSON messages", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "configure", tools: [] }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());

    ws.send("not json {{{");

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    ws.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });
});

describe("close()", () => {
  it("stops all sessions and shuts down cleanly", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/session?key=pk_test123`);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "configure", tools: [] }));
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalled());

    await handle.close();

    expect(mockStop).toHaveBeenCalled();
  });
});
