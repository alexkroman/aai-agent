/** @module @aai/sdk */

export {
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  defineAgent,
  tool,
} from "./sdk/mod.ts";
export type {
  AgentDef,
  AgentInput,
  ToolContext,
  ToolDef,
  ToolHandler,
} from "./sdk/mod.ts";

export { routes, serve } from "./platform/server.ts";
export { toToolHandlers } from "./platform/tool_executor.ts";

export { z } from "zod";

export { fetchJSON, HttpError } from "./_utils/fetch_json.ts";
export { getLogger, type Logger } from "./_utils/logger.ts";
