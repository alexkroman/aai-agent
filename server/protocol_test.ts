import { assertEquals } from "@std/assert";
import { z } from "zod";
import { agentToolsToSchemas } from "./protocol.ts";
import type { ToolDef } from "./agent_types.ts";

Deno.test("agentToolsToSchemas - converts tool definitions to OpenAI schema", () => {
  const tools: Record<string, ToolDef> = {
    get_weather: {
      description: "Get weather",
      parameters: z.object({ city: z.string().describe("City") }),
      handler: async () => {},
    },
    set_alarm: {
      description: "Set alarm",
      parameters: z.object({
        time: z.string(),
        label: z.string().optional(),
      }),
      handler: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  assertEquals(schemas.length, 2);
  assertEquals(schemas[0].name, "get_weather");
  assertEquals(schemas[0].description, "Get weather");
  assertEquals(
    (schemas[0].parameters as Record<string, unknown>).type,
    "object",
  );
  assertEquals(schemas[1].name, "set_alarm");
});
