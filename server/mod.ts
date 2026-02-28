/** @module @aai/server */

export { Agent } from "./agent.ts";
export type { AgentOptions } from "./agent_types.ts";
export { createOrchestrator } from "./orchestrator.ts";
export { loadPlatformConfig, type PlatformConfig } from "./config.ts";
export {
  ServerSession,
  type SessionDeps,
  type SessionTransport,
} from "./session.ts";
export {
  createServerSession,
  type SessionFactoryOptions,
} from "./session_factory.ts";
export { handleSessionWebSocket, type WsSessionOptions } from "./ws_handler.ts";
export { applyMiddleware } from "./middleware.ts";
export { FAVICON_SVG, renderAgentPage } from "./html.ts";
export { agentToolsToSchemas } from "./protocol.ts";
export { ERR, ERR_INTERNAL } from "./errors.ts";
export {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
} from "./types.ts";
export type {
  ChatMessage,
  LLMResponse,
  STTConfig,
  ToolSchema,
  TTSConfig,
} from "./types.ts";
