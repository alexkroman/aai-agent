import * as Comlink from "comlink";
import { agentToolsToSchemas } from "./protocol.ts";
import type { Agent } from "../sdk/agent.ts";
import type { ToolSchema, WorkerReadyConfig } from "./types.ts";
import { TIMEOUTS } from "../sdk/shared-protocol.ts";

export interface WorkerApi {
  getConfig(): { config: WorkerReadyConfig; toolSchemas: ToolSchema[] };
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;
}

export function startWorker(
  agent: Agent,
  secrets: Record<string, string>,
  precomputedSchemas?: ToolSchema[],
  endpoint?: Comlink.Endpoint,
): void {
  const toolHandlers = agent.getToolHandlers();
  const toolSchemas = precomputedSchemas ?? agentToolsToSchemas(agent.tools);

  const api: WorkerApi = {
    getConfig() {
      return { config: agent.config, toolSchemas };
    },

    async executeTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      const tool = toolHandlers.get(name);
      if (!tool) return `Error: Unknown tool "${name}"`;

      try {
        const signal = AbortSignal.timeout(TIMEOUTS.TOOL_HANDLER);
        const ctx = {
          secrets: { ...secrets },
          fetch: globalThis.fetch,
          signal,
        };
        const result = await Promise.race([
          Promise.resolve(tool.handler(args as Record<string, unknown>, ctx)),
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
        ]);
        if (result == null) return "null";
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  Comlink.expose(api, endpoint);
}
