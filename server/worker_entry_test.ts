import { assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "zod";
import * as Comlink from "comlink";
import { tool } from "./tool.ts";
import { startWorker, type WorkerApi } from "./worker_entry.ts";

function createHarness(
  agent: {
    name: string;
    instructions: string;
    greeting: string;
    voice: string;
    prompt?: string;
    builtinTools?: readonly string[];
    tools: Record<string, ReturnType<typeof tool>>;
  },
  secrets: Record<string, string> = {},
) {
  const channel = new MessageChannel();
  startWorker(agent, secrets, undefined, channel.port1);
  const workerApi = Comlink.wrap<WorkerApi>(channel.port2);

  return {
    workerApi,
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

const BASE_AGENT = {
  name: "TestBot",
  instructions: "Test instructions",
  greeting: "Hi!",
  voice: "jess",
  tools: {},
};

Deno.test("getConfig returns agent config and tool schemas", async () => {
  const h = createHarness({
    ...BASE_AGENT,
    tools: {
      greet: tool({
        description: "Greet someone",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hi ${name}`,
      }),
    },
  });
  try {
    const { config, toolSchemas } = await h.workerApi.getConfig();
    assertEquals(config.name, "TestBot");
    assertEquals(config.instructions, "Test instructions");
    assertEquals(config.greeting, "Hi!");
    assertEquals(config.voice, "jess");
    assertEquals(toolSchemas.length, 1);
    assertEquals(toolSchemas[0].name, "greet");
  } finally {
    h.close();
  }
});

Deno.test("executeTool runs handler through Comlink", async () => {
  const h = createHarness({
    ...BASE_AGENT,
    tools: {
      greet: tool({
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        handler: ({ name }) => `Hello, ${name}!`,
      }),
    },
  });
  try {
    assertEquals(
      await h.workerApi.executeTool("greet", { name: "World" }),
      "Hello, World!",
    );
  } finally {
    h.close();
  }
});

Deno.test("executeTool returns error string for unknown tool", async () => {
  const h = createHarness(BASE_AGENT);
  try {
    assertStringIncludes(
      await h.workerApi.executeTool("nope", {}),
      "Unknown tool",
    );
  } finally {
    h.close();
  }
});
