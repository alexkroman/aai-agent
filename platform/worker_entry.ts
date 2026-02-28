import * as Comlink from "comlink";
import { agentToolsToSchemas } from "./protocol.ts";
import type { AgentDef } from "../sdk/agent.ts";
import { toToolHandlers } from "./tool_executor.ts";
import type { AgentConfig, ToolSchema } from "./types.ts";

const TOOL_HANDLER_TIMEOUT = 30_000;

export interface WorkerApi {
  getConfig(): { config: AgentConfig; toolSchemas: ToolSchema[] };
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;
}

export function startWorker(
  agent: AgentDef,
  secrets: Record<string, string>,
  precomputedSchemas?: ToolSchema[],
  endpoint?: Comlink.Endpoint,
): void {
  const toolHandlers = toToolHandlers(agent.tools);
  const toolSchemas = precomputedSchemas ?? agentToolsToSchemas(agent.tools);

  const config: AgentConfig = {
    name: agent.name,
    instructions: agent.instructions,
    greeting: agent.greeting,
    voice: agent.voice,
    prompt: agent.prompt,
    builtinTools: agent.builtinTools ? [...agent.builtinTools] : undefined,
  };

  const api: WorkerApi = {
    getConfig() {
      return { config, toolSchemas };
    },

    async executeTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      const tool = toolHandlers.get(name);
      if (!tool) return `Error: Unknown tool "${name}"`;

      try {
        const ctx = {
          secrets: { ...secrets },
          fetch: globalThis.fetch,
          signal: AbortSignal.timeout(TOOL_HANDLER_TIMEOUT),
        };
        const result = await Promise.resolve(
          tool.handler(args as Record<string, unknown>, ctx),
        );
        if (result == null) return "null";
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  Comlink.expose(api, endpoint);
}
