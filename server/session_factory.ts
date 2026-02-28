import type { PlatformConfig } from "./config.ts";
import type { AgentConfig, ToolSchema } from "./types.ts";
import type { ExecuteTool } from "./tool_executor.ts";
import {
  ServerSession,
  type SessionDeps,
  type SessionTransport,
} from "./session.ts";
import { connectStt } from "./stt.ts";
import { callLLM } from "./llm.ts";
import { TtsClient } from "./tts.ts";
import { executeBuiltinTool } from "./builtin_tools.ts";

export interface SessionFactoryOptions {
  platformConfig: PlatformConfig;
  executeTool: ExecuteTool;
  depsOverride?: Partial<SessionDeps>;
}

export function createServerSession(
  sessionId: string,
  ws: SessionTransport,
  agentConfig: AgentConfig,
  toolSchemas: ToolSchema[],
  opts: SessionFactoryOptions,
): ServerSession {
  const deps: SessionDeps = {
    config: {
      ...opts.platformConfig,
      ttsConfig: { ...opts.platformConfig.ttsConfig },
    },
    connectStt: opts.depsOverride?.connectStt ?? connectStt,
    callLLM: opts.depsOverride?.callLLM ?? callLLM,
    ttsClient: opts.depsOverride?.ttsClient ??
      new TtsClient(opts.platformConfig.ttsConfig),
    executeTool: opts.depsOverride?.executeTool ?? opts.executeTool,
    executeBuiltinTool: opts.depsOverride?.executeBuiltinTool ??
      executeBuiltinTool,
  };
  return new ServerSession(sessionId, ws, agentConfig, toolSchemas, deps);
}
