import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { writeFile, unlink, mkdir, readdir, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

import { startServer, loadSecretsFile, type ServerHandle, type ServerOptions } from "../server.js";
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
function startTestServer(opts: Partial<ServerOptions> = {}): Promise<ServerHandle> {
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
      })
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

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
      expect(errMsg.message).toBe("First message must be a valid configure message");

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("configures session and sends ready + greeting", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
        })
      );

      // Wait for ready and greeting messages
      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
          expect(messages.some((m) => m.type === "greeting")).toBe(true);
        },
        { timeout: 5000 }
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

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
        { timeout: 5000 }
      );

      // Cancel
      ws.send(JSON.stringify({ type: "cancel" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "cancelled")).toBe(true);
        },
        { timeout: 5000 }
      );

      // Reset
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

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
        { timeout: 5000 }
      );

      // Close the connection — should clean up without errors
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
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
      expect(resp.headers.get("cache-control")).toContain("max-age=3600");
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
      server = await startTestServer(); // no clientDir

      const resp = await fetch(`http://localhost:${server.port}/client.js`);
      expect(resp.status).toBe(404);
    });

    it("returns 404 for missing file in clientDir", async () => {
      const tmpDir = join(tmpdir(), `aai-test-${randomBytes(4).toString("hex")}`);
      await mkdir(tmpDir, { recursive: true });
      // Don't create client.js

      server = await startTestServer({ clientDir: tmpDir });

      const resp = await fetch(`http://localhost:${server.port}/client.js`);
      expect(resp.status).toBe(404);

      await rmdir(tmpDir);
    });
  });

  describe("WebSocket edge cases", () => {
    it("silently ignores binary data before configure", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Send binary data before any configure message
      ws.send(Buffer.from([0x00, 0x01, 0x02]));

      // Wait a bit to ensure no crash
      await new Promise((r) => setTimeout(r, 100));

      // Connection should still be alive — send configure and verify it works
      const messages: any[] = [];
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // skip binary
        }
      });

      ws.send(JSON.stringify({ type: "configure" }));

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 }
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("silently ignores invalid JSON messages", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Send invalid JSON
      ws.send("not valid json {{{");

      // Wait a bit — should not crash
      await new Promise((r) => setTimeout(r, 100));

      // Connection should still be alive
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
        { timeout: 5000 }
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("handles WS close without configure (no session to clean up)", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Close immediately without configuring
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      // Should not throw or leave dangling resources
    });

    it("ignores unrecognized control messages after configure", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
        { timeout: 5000 }
      );

      // Send unrecognized control message — should be silently ignored
      ws.send(JSON.stringify({ type: "unknown_command", data: "test" }));

      // Wait and confirm no error
      await new Promise((r) => setTimeout(r, 100));

      // No error message should have been sent
      expect(messages.filter((m) => m.type === "error")).toHaveLength(0);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("cleans up multiple sessions on server close", async () => {
      server = await startTestServer();

      // Open two sessions
      const ws1 = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test1`);
      const ws2 = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test2`);

      await Promise.all([
        new Promise<void>((resolve) => ws1.on("open", resolve)),
        new Promise<void>((resolve) => ws2.on("open", resolve)),
      ]);

      const messages1: any[] = [];
      const messages2: any[] = [];
      ws1.on("message", (data) => {
        try {
          messages1.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });
      ws2.on("message", (data) => {
        try {
          messages2.push(JSON.parse(data.toString()));
        } catch {
          // skip
        }
      });

      ws1.send(JSON.stringify({ type: "configure" }));
      ws2.send(JSON.stringify({ type: "configure" }));

      await vi.waitFor(
        () => {
          expect(messages1.some((m) => m.type === "ready")).toBe(true);
          expect(messages2.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 }
      );

      // Close server — should clean up both sessions
      await server.close();

      // Prevent afterEach from double-closing
      server = null as any;
    });

    it("relays binary audio to session after configure", async () => {
      const overrides = mockOverrides();
      server = await startServer({
        port: 0,
        sessionOverrides: overrides,
      });

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
        { timeout: 5000 }
      );

      // Send binary audio data — should be relayed to STT
      ws.send(Buffer.from([0x00, 0x01, 0x02, 0x03]));

      await new Promise((r) => setTimeout(r, 100));

      // The mock STT's send should have been called with the audio data
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

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_customer_abc`);
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
        })
      );

      await vi.waitFor(
        () => {
          expect(messages.some((m) => m.type === "ready")).toBe(true);
        },
        { timeout: 5000 }
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));

      // Cleanup
      await unlink(secretsPath);
      await rmdir(tmpDir);
    });

    it("starts without secrets file", async () => {
      server = await startTestServer();

      const ws = new WebSocket(`ws://localhost:${server.port}/session?key=pk_test`);
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
        { timeout: 5000 }
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
