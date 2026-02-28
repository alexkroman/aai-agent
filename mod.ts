/**
 * @module @aai/sdk
 *
 * Minimalistic Deno framework for building voice agent applications.
 *
 * @example
 * ```ts
 * import { Agent, z } from "@aai/sdk";
 *
 * export const agent = new Agent({ name: "My Assistant" })
 *   .tool("greet", {
 *     description: "Greet someone by name",
 *     parameters: z.object({ name: z.string() }),
 *     handler: ({ name }) => `Hello, ${name}!`,
 *   })
 *   .onConnect(({ sessionId }) => {
 *     console.log(`Session ${sessionId} connected`);
 *   });
 * ```
 */

// ── Core ────────────────────────────────────────────────────────────

export { Agent } from "./sdk/agent.ts";
export type {
  AgentHooks,
  AgentOptions,
  StoredToolDef,
  ToolContext,
  ToolDef,
} from "./sdk/agent.ts";

// ── Schema (locked version, avoids zod version drift) ───────────────

export { z } from "zod";

// ── Session lifecycle ───────────────────────────────────────────────

export type {
  ConnectHandler,
  DisconnectHandler,
  ErrorHandler,
  SessionContext,
  TurnHandler,
} from "./sdk/types.ts";

// ── Utilities ───────────────────────────────────────────────────────

export { fetchJSON } from "./sdk/fetch-json.ts";
export { createLogger, type Logger } from "./sdk/logger.ts";
