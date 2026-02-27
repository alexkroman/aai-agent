import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { writeFile, unlink, mkdir, readdir, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

import { startServer, loadSecretsFile, type ServerHandle, type ServerOptions } from "../server.js";
import type { SessionDeps } from "../session.js";

/** Create mock session deps that prevent real STT/TTS/LLM API calls. */
function mockSessionDeps(): Partial<SessionDeps> {
  return {
    connectStt: vi.fn().mockResolvedValue({
      send: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
    }),
    callLLM: vi.fn().mockResolvedValue({
      id: "mock",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Mock response" },
          finish_reason: "stop",
        },
      ],
    }),
    ttsClient: {
      synthesize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any,
    sandbox: {
      execute: vi.fn().mockResolvedValue("mock result"),
      dispose: vi.fn(),
    } as any,
    normalizeVoiceText: vi.fn((text: string) => text) as any,
  };
}

/** Convenience to start a server with mocked session dependencies. */
function startTestServer(opts: Partial<ServerOptions> = {}): Promise<ServerHandle> {
  return startServer({
    port: 0,
    sessionDepsOverride: mockSessionDeps(),
    ...opts,
  });
}

/** Helper: authenticate + configure a WS connection. Returns collected messages. */
async function authAndConfigure(
  ws: WebSocket,
  apiKey = "pk_test",
  configOverrides: Record<string, unknown> = {}
): Promise<any[]> {
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // skip binary
    }
  });

  ws.send(JSON.stringify({ type: "authenticate", apiKey }));
  ws.send(JSON.stringify({ type: "configure", ...configOverrides }));

  await vi.waitFor(
    () => {
      expect(messages.some((m) => m.type === "ready")).toBe(true);
    },
    { timeout: 5000 }
  );

  return messages;
}

// ── loadSecretsFile unit tests ──────────────────────────────────

describe("loadSecretsFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `aai-test-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      const files = await readdir(tmpDir);
      for (const f of files) await unlink(join(tmpDir, f));
      await rmdir(tmpDir);
    } catch {
      // ignore
    }
  });

  it("loads and parses a valid secrets file", async () => {
    const path = join(tmpDir, "secrets.json");
    await writeFile(
      path,
      JSON.stringify({
        pk_abc: { KEY1: "val1", KEY2: "val2" },
        pk_def: { KEY3: "val3" },
      })
    );

    const secrets = await loadSecretsFile(path);

    expect(secrets).toEqual({
      pk_abc: { KEY1: "val1", KEY2: "val2" },
      pk_def: { KEY3: "val3" },
    });
  });

  it("returns empty object for missing file", async () => {
    const secrets = await loadSecretsFile("/nonexistent/secrets.json");
    expect(secrets).toEqual({});
  });

  it("returns empty object for invalid JSON", async () => {
    const path = join(tmpDir, "bad.json");
    await writeFile(path, "not valid json {{{");

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const secrets = await loadSecretsFile(path);
    expect(secrets).toEqual({});

    consoleSpy.mockRestore();
  });

  it("handles empty secrets file", async () => {
    const path = join(tmpDir, "empty.json");
    await writeFile(path, "{}");

    const secrets = await loadSecretsFile(path);
    expect(secrets).toEqual({});
  });
});

// ── Server integration tests ────────────────────────────────────

describe("server", () => {
  let server: ServerHandle;

  beforeEach(() => {
    process.env.ASSEMBLYAI_API_KEY = "test-key";
    process.env.ASSEMBLYAI_TTS_API_KEY = "test-tts-key";
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_TTS_API_KEY;
  });

  describe("HTTP endpoints", () => {
    it("health check returns ok", async () => {
      server = await startTestServer();

      const resp = await fetch(`http://localhost:${server.port}/health`);
      const body = await resp.json();

      expect(resp.status).toBe(200);
      expect(body).toEqual({ status: "ok" });
    });

    it("returns 404 for unknown paths", async () => {
      server = await startTestServer();

      const resp = await fetch(`http://localhost:${server.port}/nonexistent`);
      expect(resp.status).toBe(404);
    });

    it("handles CORS preflight", async () => {
      server = await startTestServer();

      const resp = await fetch(`http://localhost:${server.port}/session`, {
        method: "OPTIONS",
      });

      expect(resp.status).toBe(204);
      expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

  describe("WebSocket authentication", () => {
    it("rejects connection without authenticate message", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws.send(JSON.stringify({ type: "configure" }));

      await vi.waitFor(() => {
        expect(messages.some((m) => m.type === "error")).toBe(true);
      });

      const errMsg = messages.find((m) => m.type === "error");
      expect(errMsg.message).toBe("Missing API key");

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("rejects authenticate with empty apiKey", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws.send(JSON.stringify({ type: "authenticate", apiKey: "" }));

      await vi.waitFor(() => {
        expect(messages.some((m) => m.type === "error")).toBe(true);
      });

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("accepts authenticate then configure", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages = await authAndConfigure(ws);

      const readyMsg = messages.find((m) => m.type === "ready");
      expect(readyMsg.sampleRate).toBe(16000);
      expect(readyMsg.ttsSampleRate).toBe(24000);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe("WebSocket", () => {
    it("rejects invalid configure message after authenticate", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws.send(JSON.stringify({ type: "authenticate", apiKey: "pk_test" }));
      await new Promise((r) => setTimeout(r, 50));
      ws.send(JSON.stringify({ type: "not_configure" }));

      await vi.waitFor(() => {
        expect(messages.some((m) => m.type === "error")).toBe(true);
      });

      const errMsg = messages.find((m) => m.type === "error");
      expect(errMsg.message).toBe("First message must be a valid configure message");

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("configures session and sends ready + greeting", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages = await authAndConfigure(ws, "pk_test", {
        instructions: "Be helpful",
        greeting: "Hello!",
      });

      const readyMsg = messages.find((m) => m.type === "ready");
      expect(readyMsg.sampleRate).toBe(16000);
      expect(readyMsg.ttsSampleRate).toBe(24000);

      const greetingMsg = messages.find((m) => m.type === "greeting");
      expect(greetingMsg.text).toBe("Hello!");

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("handles cancel and reset commands", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages = await authAndConfigure(ws);

      ws.send(JSON.stringify({ type: "cancel" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "cancelled")).toBe(true);
        },
        { timeout: 5000 }
      );

      ws.send(JSON.stringify({ type: "reset" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "reset")).toBe(true);
        },
        { timeout: 5000 }
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("gracefully handles session disconnect", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      await authAndConfigure(ws);

      ws.close();
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  describe("ping/pong", () => {
    it("responds to ping with pong", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      await authAndConfigure(ws);

      const pongMessages: any[] = [];
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "pong") pongMessages.push(msg);
        } catch {
          // skip
        }
      });

      ws.send(JSON.stringify({ type: "ping" }));

      await vi.waitFor(() => {
        expect(pongMessages.length).toBe(1);
      });

      expect(pongMessages[0].type).toBe("pong");

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("responds to ping even before authenticate", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws.send(JSON.stringify({ type: "ping" }));

      await vi.waitFor(() => {
        expect(messages.some((m) => m.type === "pong")).toBe(true);
      });

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe("HTTP file serving", () => {
    it("serves client.js when clientDir is configured", async () => {
      const tmpDir = join(tmpdir(), `aai-test-${randomBytes(4).toString("hex")}`);
      await mkdir(tmpDir, { recursive: true });
      await writeFile(join(tmpDir, "client.js"), "// client bundle");

      server = await startTestServer({ clientDir: tmpDir });

      const resp = await fetch(`http://localhost:${server.port}/client.js`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("content-type")).toContain("application/javascript");
      expect(resp.headers.get("access-control-allow-origin")).toBe("*");
      expect(resp.headers.get("cache-control")).toBe("no-cache");
      const body = await resp.text();
      expect(body).toBe("// client bundle");

      await unlink(join(tmpDir, "client.js"));
      await rmdir(tmpDir);
    });

    it("serves react.js when clientDir is configured", async () => {
      const tmpDir = join(tmpdir(), `aai-test-${randomBytes(4).toString("hex")}`);
      await mkdir(tmpDir, { recursive: true });
      await writeFile(join(tmpDir, "react.js"), "// react bundle");

      server = await startTestServer({ clientDir: tmpDir });

      const resp = await fetch(`http://localhost:${server.port}/react.js`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("content-type")).toContain("application/javascript");
      const body = await resp.text();
      expect(body).toBe("// react bundle");

      await unlink(join(tmpDir, "react.js"));
      await rmdir(tmpDir);
    });

    it("returns 404 for client.js when clientDir is not configured", async () => {
      server = await startTestServer();

      const resp = await fetch(`http://localhost:${server.port}/client.js`);
      expect(resp.status).toBe(404);
    });

    it("returns 404 for missing file in clientDir", async () => {
      const tmpDir = join(tmpdir(), `aai-test-${randomBytes(4).toString("hex")}`);
      await mkdir(tmpDir, { recursive: true });

      server = await startTestServer({ clientDir: tmpDir });

      const resp = await fetch(`http://localhost:${server.port}/client.js`);
      expect(resp.status).toBe(404);

      await rmdir(tmpDir);
    });
  });

  describe("WebSocket edge cases", () => {
    it("silently ignores binary data before configure", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(Buffer.from([0x00, 0x01, 0x02]));

      await new Promise((r) => setTimeout(r, 100));

      const messages = await authAndConfigure(ws);
      expect(messages.some((m) => m.type === "ready")).toBe(true);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("silently ignores invalid JSON messages", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send("not valid json {{{");

      await new Promise((r) => setTimeout(r, 100));

      const messages = await authAndConfigure(ws);
      expect(messages.some((m) => m.type === "ready")).toBe(true);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("handles WS close without configure (no session to clean up)", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.close();
      await new Promise((r) => setTimeout(r, 100));
    });

    it("ignores unrecognized control messages after configure", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages = await authAndConfigure(ws);
      const errorsBefore = messages.filter((m) => m.type === "error").length;

      ws.send(JSON.stringify({ type: "unknown_command", data: "test" }));

      await new Promise((r) => setTimeout(r, 100));

      expect(messages.filter((m) => m.type === "error").length).toBe(errorsBefore);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("cleans up multiple sessions on server close", async () => {
      server = await startTestServer();

      const ws1 = new WebSocket(`ws://localhost:${server.port}/session`);
      const ws2 = new WebSocket(`ws://localhost:${server.port}/session`);

      await Promise.all([
        new Promise<void>((resolve) => ws1.on("open", resolve)),
        new Promise<void>((resolve) => ws2.on("open", resolve)),
      ]);

      await Promise.all([authAndConfigure(ws1, "pk_test1"), authAndConfigure(ws2, "pk_test2")]);

      await server.close();
      server = null as any;
    });

    it("relays binary audio to session after configure", async () => {
      const overrides = mockSessionDeps();
      server = await startServer({
        port: 0,
        sessionDepsOverride: overrides,
      });

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      await authAndConfigure(ws);

      ws.send(Buffer.from([0x00, 0x01, 0x02, 0x03]));

      await new Promise((r) => setTimeout(r, 100));

      const sttHandle = await (overrides.connectStt as ReturnType<typeof vi.fn>).mock.results[0]
        .value;
      expect(sttHandle.send).toHaveBeenCalled();

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe("secrets integration", () => {
    it("loads secrets from file and passes to sessions", async () => {
      const tmpDir = join(tmpdir(), `aai-test-${randomBytes(4).toString("hex")}`);
      await mkdir(tmpDir, { recursive: true });
      const secretsPath = join(tmpDir, "secrets.json");
      await writeFile(
        secretsPath,
        JSON.stringify({
          pk_customer_abc: {
            WEATHER_API_KEY: "sk-abc123",
          },
        })
      );

      server = await startTestServer({ secretsFile: secretsPath });

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      await authAndConfigure(ws, "pk_customer_abc", {
        instructions: "Test",
        tools: [
          {
            name: "use_secret",
            description: "Use a secret",
            parameters: {},
            handler: "async (args, ctx) => ctx.secrets.WEATHER_API_KEY",
          },
        ],
      });

      ws.close();
      await new Promise((r) => setTimeout(r, 50));

      await unlink(secretsPath);
      await rmdir(tmpDir);
    });

    it("starts without secrets file", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      await authAndConfigure(ws);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
