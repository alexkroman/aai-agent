import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { writeFile, unlink, mkdir, readdir, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

import {
  startServer,
  loadSecretsFile,
  type ServerHandle,
  type ServerOptions,
} from "../server.js";
import type { SessionOverrides } from "../session.js";

/** Create mock overrides that prevent real STT/TTS/LLM API calls. */
function mockOverrides(): SessionOverrides {
  return {
    connectStt: vi.fn().mockResolvedValue({
      send: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
    }),
    synthesize: vi.fn().mockResolvedValue(undefined),
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
  };
}

/** Convenience to start a server with mocked session dependencies. */
function startTestServer(
  opts: Partial<ServerOptions> = {},
): Promise<ServerHandle> {
  return startServer({
    port: 0,
    sessionOverrides: mockOverrides(),
    ...opts,
  });
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
      }),
    );

    const secrets = await loadSecretsFile(path);

    expect(secrets).toEqual({
      pk_abc: { KEY1: "val1", KEY2: "val2" },
      pk_def: { KEY3: "val3" },
    });
  });

  it("returns empty object for missing file", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const secrets = await loadSecretsFile("/nonexistent/secrets.json");
    expect(secrets).toEqual({});
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
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

  afterEach(async () => {
    if (server) {
      await server.close();
    }
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

  describe("WebSocket", () => {
    it("rejects connection without API key", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session`);

      const msg = await new Promise<any>((resolve) => {
        ws.on("message", (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(msg.type).toBe("error");
      expect(msg.message).toBe("Missing API key");
    });

    it("rejects invalid configure message", async () => {
      server = await startTestServer();

      const ws = new WebSocket(
        `ws://localhost:${server.port}/session?key=pk_test`,
      );
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws.send(JSON.stringify({ type: "not_configure" }));

      await vi.waitFor(() => {
        expect(messages.some((m) => m.type === "error")).toBe(true);
      });

      const errMsg = messages.find((m) => m.type === "error");
      expect(errMsg.message).toBe(
        "First message must be a valid configure message",
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("configures session and sends ready + greeting", async () => {
      server = await startTestServer();

      const ws = new WebSocket(
        `ws://localhost:${server.port}/session?key=pk_test`,
      );
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip binary
        }
      });

      ws.send(
        JSON.stringify({
          type: "configure",
          instructions: "Be helpful",
          greeting: "Hello!",
        }),
      );

      // Wait for ready and greeting messages
      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
          expect(messages.some((m) => m.type === "greeting")).toBe(true);
        },
        { timeout: 5000 },
      );

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

      const ws = new WebSocket(
        `ws://localhost:${server.port}/session?key=pk_test`,
      );
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      // Configure first
      ws.send(JSON.stringify({ type: "configure" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 },
      );

      // Cancel
      ws.send(JSON.stringify({ type: "cancel" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "cancelled")).toBe(true);
        },
        { timeout: 5000 },
      );

      // Reset
      ws.send(JSON.stringify({ type: "reset" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "reset")).toBe(true);
        },
        { timeout: 5000 },
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("gracefully handles session disconnect", async () => {
      server = await startTestServer();

      const ws = new WebSocket(
        `ws://localhost:${server.port}/session?key=pk_test`,
      );
      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(JSON.stringify({ type: "configure" }));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 },
      );

      // Close the connection — should clean up without errors
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  describe("secrets integration", () => {
    it("loads secrets from file and passes to sessions", async () => {
      const tmpDir = join(
        tmpdir(),
        `aai-test-${randomBytes(4).toString("hex")}`,
      );
      await mkdir(tmpDir, { recursive: true });
      const secretsPath = join(tmpDir, "secrets.json");
      await writeFile(
        secretsPath,
        JSON.stringify({
          pk_customer_abc: {
            WEATHER_API_KEY: "sk-abc123",
          },
        }),
      );

      server = await startTestServer({ secretsFile: secretsPath });

      const ws = new WebSocket(
        `ws://localhost:${server.port}/session?key=pk_customer_abc`,
      );
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws.send(
        JSON.stringify({
          type: "configure",
          instructions: "Test",
          tools: [
            {
              name: "use_secret",
              description: "Use a secret",
              parameters: {},
              handler: "async (args, ctx) => ctx.secrets.WEATHER_API_KEY",
            },
          ],
        }),
      );

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 },
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));

      // Cleanup
      await unlink(secretsPath);
      await rmdir(tmpDir);
    });

    it("starts without secrets file", async () => {
      server = await startTestServer();

      const ws = new WebSocket(
        `ws://localhost:${server.port}/session?key=pk_test`,
      );
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

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 },
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
