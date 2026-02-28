import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import * as Comlink from "comlink";
import { Agent } from "../agent.ts";
import { startWorker } from "../worker-entry.ts";
import type { WorkerApi } from "../worker-entry.ts";

/**
 * Creates a MessageChannel-based harness that simulates Worker <-> main
 * Comlink tunnel. port1 is the worker-side endpoint passed to startWorker(),
 * port2 is the main-side endpoint wrapped by Comlink.wrap().
 */
function createComlinkHarness(
  agent: Agent,
  secrets: Record<string, string> = {},
) {
  const channel = new MessageChannel();

  // Expose the worker API on port1 (the "worker side")
  startWorker(agent, secrets, undefined, channel.port1);

  // Wrap port2 (the "main side") with Comlink
  const workerApi = Comlink.wrap<WorkerApi>(channel.port2);

  function restore() {
    channel.port1.close();
    channel.port2.close();
  }

  return { workerApi, restore };
}

describe("startWorker (Comlink)", () => {
  it("getConfig() returns correct config", async () => {
    const agent = new Agent({
      name: "TestBot",
      instructions: "Test",
      greeting: "Hi!",
      voice: "jess",
    });

    const harness = createComlinkHarness(agent, { KEY: "val" });
    try {
      const result = await harness.workerApi.getConfig();
      expect(result.config.name).toBe("TestBot");
      expect(result.config.instructions).toBe("Test");
      expect(result.config.greeting).toBe("Hi!");
      expect(result.config.voice).toBe("jess");
      expect(Array.isArray(result.toolSchemas)).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it("executeTool() with valid tool", async () => {
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

    const harness = createComlinkHarness(agent);
    try {
      const result = await harness.workerApi.executeTool("greet", {
        name: "World",
      });
      expect(result).toBe("Hello, World!");
    } finally {
      harness.restore();
    }
  });

  it("executeTool() with unknown tool", async () => {
    const agent = new Agent({
      name: "Bot",
      instructions: "Test",
      greeting: "Hi",
      voice: "jess",
    });

    const harness = createComlinkHarness(agent);
    try {
      const result = await harness.workerApi.executeTool("nonexistent", {});
      expect(result).toContain("Error");
      expect(result).toContain("nonexistent");
    } finally {
      harness.restore();
    }
  });

  it("executeTool() when handler throws", async () => {
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

    const harness = createComlinkHarness(agent);
    try {
      const result = await harness.workerApi.executeTool("fail", {});
      expect(result).toContain("Error");
      expect(result).toContain("boom");
    } finally {
      harness.restore();
    }
  });

  it("executeTool() returns 'null' when handler returns null", async () => {
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

    const harness = createComlinkHarness(agent);
    try {
      const result = await harness.workerApi.executeTool("noop", {});
      expect(result).toBe("null");
    } finally {
      harness.restore();
    }
  });
});
