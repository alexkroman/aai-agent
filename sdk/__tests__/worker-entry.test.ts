import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import { Agent } from "../agent.ts";
import { startWorker } from "../worker-entry.ts";
import type { WorkerInMessage, WorkerOutMessage } from "./_test-utils.ts";

/** Typed self interface for worker simulation. */
interface WorkerSelf {
  postMessage: (msg: WorkerOutMessage) => void;
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null;
}

// Simulate Worker's self.onmessage / self.postMessage
function createWorkerHarness(agent: Agent) {
  const postedMessages: WorkerOutMessage[] = [];

  // Save original
  const originalPostMessage = (globalThis as unknown as { self: WorkerSelf })
    .self?.postMessage;
  const originalOnMessage = (globalThis as unknown as { self: WorkerSelf })
    .self?.onmessage;

  // Ensure self exists and mock postMessage
  const selfObj = globalThis as unknown as { self: WorkerSelf };
  selfObj.self ??= selfObj as unknown as WorkerSelf;
  selfObj.self.postMessage = (msg: WorkerOutMessage) => {
    postedMessages.push(msg);
  };

  startWorker(agent);

  // Get the onmessage handler that startWorker set up
  const handler = selfObj.self.onmessage;

  async function send(data: WorkerInMessage) {
    await handler?.(new MessageEvent("message", { data }));
  }

  function restore() {
    if (originalPostMessage) {
      selfObj.self.postMessage = originalPostMessage;
    }
    if (originalOnMessage) {
      selfObj.self.onmessage = originalOnMessage;
    }
  }

  return { send, postedMessages, restore };
}

describe("startWorker", () => {
  it("responds to init with ready message", async () => {
    const agent = new Agent({
      name: "TestBot",
      instructions: "Test",
      greeting: "Hi!",
      voice: "jess",
    });

    const harness = createWorkerHarness(agent);
    try {
      await harness.send({
        type: "init",
        slug: "test-bot",
        secrets: { KEY: "val" },
      });

      expect(harness.postedMessages.length).toBe(1);
      const msg = harness.postedMessages[0];
      expect(msg.type).toBe("ready");
      if (msg.type === "ready") {
        expect(msg.slug).toBe("test-bot");
        expect(msg.config.name).toBe("TestBot");
        expect(Array.isArray(msg.toolSchemas)).toBe(true);
      }
    } finally {
      harness.restore();
    }
  });

  it("handles tool.call with valid tool", async () => {
    const agent = new Agent({
      name: "Bot",
      instructions: "Test",
      greeting: "Hi",
      voice: "jess",
    }).tool("greet", {
      description: "Greet",
      parameters: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    });

    const harness = createWorkerHarness(agent);
    try {
      await harness.send({
        type: "init",
        slug: "bot",
        secrets: {},
      });

      await harness.send({
        type: "tool.call",
        callId: "call-1",
        name: "greet",
        args: { name: "World" },
      });

      const results = harness.postedMessages.filter(
        (m) => m.type === "tool.result",
      );
      expect(results.length).toBe(1);
      if (results[0].type === "tool.result") {
        expect(results[0].callId).toBe("call-1");
        expect(results[0].result).toBe("Hello, World!");
      }
    } finally {
      harness.restore();
    }
  });

  it("handles tool.call with unknown tool", async () => {
    const agent = new Agent({
      name: "Bot",
      instructions: "Test",
      greeting: "Hi",
      voice: "jess",
    });

    const harness = createWorkerHarness(agent);
    try {
      await harness.send({ type: "init", slug: "bot", secrets: {} });
      await harness.send({
        type: "tool.call",
        callId: "call-2",
        name: "nonexistent",
        args: {},
      });

      const results = harness.postedMessages.filter(
        (m) => m.type === "tool.result",
      );
      expect(results.length).toBe(1);
      if (results[0].type === "tool.result") {
        expect(results[0].result).toContain("Error");
        expect(results[0].result).toContain("nonexistent");
      }
    } finally {
      harness.restore();
    }
  });

  it("handles tool.call with invalid args", async () => {
    const agent = new Agent({
      name: "Bot",
      instructions: "Test",
      greeting: "Hi",
      voice: "jess",
    }).tool("greet", {
      description: "Greet",
      parameters: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    });

    const harness = createWorkerHarness(agent);
    try {
      await harness.send({ type: "init", slug: "bot", secrets: {} });
      await harness.send({
        type: "tool.call",
        callId: "call-3",
        name: "greet",
        args: { name: 123 as unknown as string },
      });

      const results = harness.postedMessages.filter(
        (m) => m.type === "tool.result",
      );
      expect(results.length).toBe(1);
      if (results[0].type === "tool.result") {
        expect(results[0].result).toContain("Error");
        expect(results[0].result).toContain("Invalid arguments");
      }
    } finally {
      harness.restore();
    }
  });

  it("handles tool.call when handler throws", async () => {
    const agent = new Agent({
      name: "Bot",
      instructions: "Test",
      greeting: "Hi",
      voice: "jess",
    }).tool("fail", {
      description: "Fail",
      parameters: z.object({}),
      handler: () => {
        throw new Error("boom");
      },
    });

    const harness = createWorkerHarness(agent);
    try {
      await harness.send({ type: "init", slug: "bot", secrets: {} });
      await harness.send({
        type: "tool.call",
        callId: "call-4",
        name: "fail",
        args: {},
      });

      const results = harness.postedMessages.filter(
        (m) => m.type === "tool.result",
      );
      expect(results.length).toBe(1);
      if (results[0].type === "tool.result") {
        expect(results[0].result).toContain("Error");
        expect(results[0].result).toContain("boom");
      }
    } finally {
      harness.restore();
    }
  });

  it("returns 'null' when handler returns null", async () => {
    const agent = new Agent({
      name: "Bot",
      instructions: "Test",
      greeting: "Hi",
      voice: "jess",
    }).tool("noop", {
      description: "Noop",
      parameters: z.object({}),
      handler: () => null,
    });

    const harness = createWorkerHarness(agent);
    try {
      await harness.send({ type: "init", slug: "bot", secrets: {} });
      await harness.send({
        type: "tool.call",
        callId: "call-5",
        name: "noop",
        args: {},
      });

      const results = harness.postedMessages.filter(
        (m) => m.type === "tool.result",
      );
      if (results[0].type === "tool.result") {
        expect(results[0].result).toBe("null");
      }
    } finally {
      harness.restore();
    }
  });
});
