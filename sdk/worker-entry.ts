// worker-entry.ts — Thin worker: holds agent config + tool handlers only.
// The main process runs VoiceSession/STT/LLM/TTS.
// Tool calls are proxied here via postMessage.

import { agentToolsToSchemas } from "./protocol.ts";
import type { Agent } from "./agent.ts";
import { executeToolCall } from "./tool-executor.ts";
import type { WorkerInMessage, WorkerOutMessage } from "./types.ts";

export function startWorker(agent: Agent): void {
  let secrets: Record<string, string> = {};
  const toolHandlers = agent.getToolHandlers();

  self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
    const msg = event.data;

    switch (msg.type) {
      case "init": {
        secrets = msg.secrets;
        const toolSchemas = agentToolsToSchemas(agent.tools);
        const ready: WorkerOutMessage = {
          type: "ready",
          slug: msg.slug,
          config: agent.config,
          toolSchemas,
        };
        self.postMessage(ready);
        break;
      }

      case "tool.call": {
        const { callId, name, args } = msg;
        const tool = toolHandlers.get(name);
        if (!tool) {
          const errMsg: WorkerOutMessage = {
            type: "tool.result",
            callId,
            result: `Error: Unknown tool "${name}"`,
          };
          self.postMessage(errMsg);
          break;
        }

        const result = await executeToolCall(name, args, tool, secrets);
        const resultMsg: WorkerOutMessage = {
          type: "tool.result",
          callId,
          result,
        };
        self.postMessage(resultMsg);
        break;
      }
    }
  };
}
