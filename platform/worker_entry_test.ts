import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import * as Comlink from "comlink";
import { defineAgent, tool } from "../sdk/agent.ts";
import { startWorker } from "./worker_entry.ts";
import type { WorkerApi } from "./worker_entry.ts";

/**
 * Creates a MessageChannel-based harness that simulates Worker <-> main
 * Comlink tunnel. port1 is the worker-side endpoint passed to startWorker(),
 * port2 is the main-side endpoint wrapped by Comlink.wrap().
 */
function createComlinkHarness(
  agent: ReturnType<typeof defineAgent>,
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

Deno.test("startWorker - getConfig() returns correct config", async () => {
  const agent = defineAgent({
    name: "TestBot",
    instructions: "Test",
    greeting: "Hi!",
    voice: "jess",
  });

  const harness = createComlinkHarness(agent, { KEY: "val" });
  try {
    const result = await harness.workerApi.getConfig();
    assertEquals(result.config.name, "TestBot");
    assertEquals(result.config.instructions, "Test");
    assertEquals(result.config.greeting, "Hi!");
    assertEquals(result.config.voice, "jess");
    assert(Array.isArray(result.toolSchemas));
  } finally {
    harness.restore();
  }
});

Deno.test("startWorker - executeTool() with valid tool", async () => {
  const agent = defineAgent({
    name: "Bot",
    instructions: "Test",
    greeting: "Hi",
    voice: "jess",
    tools: {
      greet: tool({
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hello, ${name}!`,
      }),
    },
  });

  const harness = createComlinkHarness(agent);
  try {
    const result = await harness.workerApi.executeTool("greet", {
      name: "World",
    });
    assertEquals(result, "Hello, World!");
  } finally {
    harness.restore();
  }
});

Deno.test("startWorker - executeTool() with unknown tool", async () => {
  const agent = defineAgent({
    name: "Bot",
    instructions: "Test",
    greeting: "Hi",
    voice: "jess",
  });

  const harness = createComlinkHarness(agent);
  try {
    const result = await harness.workerApi.executeTool("nonexistent", {});
    assert(result.includes("Error"));
    assert(result.includes("nonexistent"));
  } finally {
    harness.restore();
  }
});

Deno.test("startWorker - executeTool() when handler throws", async () => {
  const agent = defineAgent({
    name: "Bot",
    instructions: "Test",
    greeting: "Hi",
    voice: "jess",
    tools: {
      fail: tool({
        description: "Fail",
        parameters: z.object({}),
        handler: () => {
          throw new Error("boom");
        },
      }),
    },
  });

  const harness = createComlinkHarness(agent);
  try {
    const result = await harness.workerApi.executeTool("fail", {});
    assert(result.includes("Error"));
    assert(result.includes("boom"));
  } finally {
    harness.restore();
  }
});

Deno.test("startWorker - executeTool() returns 'null' when handler returns null", async () => {
  const agent = defineAgent({
    name: "Bot",
    instructions: "Test",
    greeting: "Hi",
    voice: "jess",
    tools: {
      noop: tool({
        description: "Noop",
        parameters: z.object({}),
        handler: () => null,
      }),
    },
  });

  const harness = createComlinkHarness(agent);
  try {
    const result = await harness.workerApi.executeTool("noop", {});
    assertEquals(result, "null");
  } finally {
    harness.restore();
  }
});
