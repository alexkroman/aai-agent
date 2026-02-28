// worker-entry.ts — Thin worker: holds agent config + tool handlers only.
// The main process runs VoiceSession/STT/LLM/TTS.
// Tool calls are proxied here via postMessage.

import { agentToolsToSchemas } from "./protocol.ts";
import type { Agent } from "./agent.ts";
import type { ToolContext } from "./tool-executor.ts";

export function startWorker(agent: Agent): void {
  let secrets: Record<string, string> = {};
  const toolHandlers = agent.getToolHandlers();

  // deno-lint-ignore no-explicit-any
  self.onmessage = async (event: MessageEvent<any>) => {
    const msg = event.data;

    switch (msg.type) {
      case "init": {
        secrets = msg.secrets ?? {};
        const toolSchemas = agentToolsToSchemas(agent.tools);
        self.postMessage({
          type: "ready",
          slug: msg.slug,
          config: agent.config,
          toolSchemas,
        });
        break;
      }

      case "tool.call": {
        const { callId, name, args } = msg;
        const tool = toolHandlers.get(name);
        if (!tool) {
          self.postMessage({
            type: "tool.result",
            callId,
            result: `Error: Unknown tool "${name}"`,
          });
          break;
        }

        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          const errors = parsed.error.issues
            .map((i: { path: (string | number)[]; message: string }) =>
              `${i.path.join(".")}: ${i.message}`
            )
            .join(", ");
          self.postMessage({
            type: "tool.result",
            callId,
            result: `Error: Invalid arguments for tool "${name}": ${errors}`,
          });
          break;
        }

        try {
          const ctx: ToolContext = {
            secrets: { ...secrets },
            fetch: globalThis.fetch,
          };
          const result = await tool.handler(
            parsed.data as Record<string, unknown>,
            ctx,
          );
          const resultStr = result === null || result === undefined
            ? "null"
            : typeof result === "string"
            ? result
            : JSON.stringify(result);
          self.postMessage({
            type: "tool.result",
            callId,
            result: resultStr,
          });
        } catch (err) {
          self.postMessage({
            type: "tool.result",
            callId,
            result: `Error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
        break;
      }
    }
  };
}
