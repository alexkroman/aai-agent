// worker-entry.ts — Thin worker: holds agent config + tool handlers only.
// The main process runs VoiceSession/STT/LLM/TTS.
// Tool calls are proxied here via Comlink (replaces manual postMessage protocol).

import * as Comlink from "comlink";
import { agentToolsToSchemas } from "../sdk/protocol.ts";
import type { Agent } from "../sdk/agent.ts";
import type { ToolSchema, WorkerReadyConfig } from "../sdk/types.ts";
import { TIMEOUTS } from "../sdk/shared-protocol.ts";

/** API exposed to the main process via Comlink. */
export interface WorkerApi {
  getConfig(): { config: WorkerReadyConfig; toolSchemas: ToolSchema[] };
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;
}

/**
 * Start the worker.
 * @param precomputedSchemas If provided, used instead of computing via zod.
 *   This allows building with a zod shim for smaller bundles.
 * @param endpoint Comlink endpoint to expose the API on (defaults to self).
 *   Pass a MessagePort for testing.
 */
export function startWorker(
  agent: Agent,
  secrets: Record<string, string>,
  precomputedSchemas?: ToolSchema[],
  endpoint?: Comlink.Endpoint,
): void {
  const toolHandlers = agent.getToolHandlers();

  // Use pre-computed schemas if available (zod may be shimmed out),
  // otherwise compute them at runtime (for dev/standalone mode).
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
      if (!tool) {
        return `Error: Unknown tool "${name}"`;
      }

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
