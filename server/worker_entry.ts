import * as Comlink from "comlink";
import { agentToolsToSchemas } from "./protocol.ts";
import type { ToolDef } from "./agent_types.ts";
import { executeToolCall, toToolHandlers } from "./tool_executor.ts";
import type { AgentConfig, ToolSchema } from "./types.ts";

interface AgentLike {
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly string[];
  readonly tools: Readonly<Record<string, ToolDef>>;
}

export interface WorkerApi {
  getConfig(): { config: AgentConfig; toolSchemas: ToolSchema[] };
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;
}

export function startWorker(
  agent: AgentLike,
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

    executeTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      const tool = toolHandlers.get(name);
      if (!tool) return Promise.resolve(`Error: Unknown tool "${name}"`);
      return executeToolCall(name, args, tool, secrets);
    },
  };

  Comlink.expose(api, endpoint);
}
