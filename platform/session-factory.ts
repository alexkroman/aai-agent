import type { PlatformConfig } from "./config.ts";
import type { AgentConfig } from "../sdk/types.ts";
import type { ToolSchema } from "./types.ts";
import type { IToolExecutor } from "./tool-executor.ts";
import type { SessionDeps, SessionTransport } from "./session.ts";
import { ServerSession } from "./session.ts";
import { connectStt } from "./stt.ts";
import { callLLM } from "./llm.ts";
import { TtsClient } from "./tts.ts";
import { normalizeVoiceText } from "./util/voice-cleaner.ts";
import { executeBuiltinTool } from "./builtin-tools.ts";

export interface SessionFactoryOptions {
  platformConfig: PlatformConfig;
  toolExecutor: IToolExecutor;
  depsOverride?: Partial<SessionDeps>;
}

export function createServerSession(
  sessionId: string,
  ws: SessionTransport,
  agentConfig: AgentConfig,
  toolSchemas: ToolSchema[],
  opts: SessionFactoryOptions,
): { session: ServerSession; agentConfig: AgentConfig } {
  const deps: SessionDeps = {
    config: {
      ...opts.platformConfig,
      ttsConfig: { ...opts.platformConfig.ttsConfig },
    },
    connectStt: opts.depsOverride?.connectStt ?? connectStt,
    callLLM: opts.depsOverride?.callLLM ?? callLLM,
    ttsClient: opts.depsOverride?.ttsClient ??
      new TtsClient(opts.platformConfig.ttsConfig),
    toolExecutor: opts.depsOverride?.toolExecutor ?? opts.toolExecutor,
    normalizeVoiceText: opts.depsOverride?.normalizeVoiceText ??
      normalizeVoiceText,
    executeBuiltinTool: opts.depsOverride?.executeBuiltinTool ??
      executeBuiltinTool,
  };
  return {
    session: new ServerSession(sessionId, ws, agentConfig, toolSchemas, deps),
    agentConfig,
  };
}
