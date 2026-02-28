// Declarative agent definition using plain data and functions.

import { z } from "zod";

/** Context provided to tool handlers at execution time. */
export interface ToolContext {
  secrets: Record<string, string>;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}

/** A registered tool handler with its Zod schema. */
export interface ToolHandler {
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

export const DEFAULT_INSTRUCTIONS = `\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing.`;

export const DEFAULT_GREETING =
  "Hey there! I'm a voice assistant. What can I help you with?";

export interface ToolDef<
  T extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  description: string;
  parameters: T;
  handler: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown> | unknown;
}

export interface AgentInput {
  name: string;
  instructions?: string;
  greeting?: string;
  voice?: string;
  prompt?: string;
  builtinTools?: string[];
  tools?: Record<string, ToolDef>;
  onConnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  onDisconnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  onError?: (error: Error, ctx?: { sessionId: string }) => void;
  onTurn?: (text: string, ctx: { sessionId: string }) => void | Promise<void>;
}

export interface AgentDef {
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly string[];
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly onConnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  readonly onDisconnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  readonly onError?: (error: Error, ctx?: { sessionId: string }) => void;
  readonly onTurn?: (
    text: string,
    ctx: { sessionId: string },
  ) => void | Promise<void>;
}

/**
 * Define a voice agent as a frozen plain object.
 *
 * @example
 * ```ts
 * import { defineAgent, tool, z } from "@aai/sdk";
 *
 * export default defineAgent({
 *   name: "Coda",
 *   instructions: "You are a code assistant.",
 *   voice: "dan",
 *   tools: {
 *     run_code: tool({
 *       description: "Execute JavaScript",
 *       parameters: z.object({ code: z.string() }),
 *       handler: ({ code }) => eval(code),
 *     }),
 *   },
 *   onConnect({ sessionId }) {
 *     console.log(`Session ${sessionId} started`);
 *   },
 * });
 * ```
 */
export function defineAgent(input: AgentInput): AgentDef {
  const def: AgentDef = {
    name: input.name,
    instructions: input.instructions ?? DEFAULT_INSTRUCTIONS,
    greeting: input.greeting ?? DEFAULT_GREETING,
    voice: input.voice ?? "jess",
    prompt: input.prompt,
    builtinTools: input.builtinTools,
    tools: input.tools ?? {},
    onConnect: input.onConnect,
    onDisconnect: input.onDisconnect,
    onError: input.onError,
    onTurn: input.onTurn,
  };
  return Object.freeze(def);
}

/** Identity function that preserves the generic type for tool parameter inference. */
export function tool<T extends z.ZodObject<z.ZodRawShape>>(
  def: ToolDef<T>,
): ToolDef<T> {
  return def;
}

/** Convert an AgentDef's tools record to a Map<string, ToolHandler> for ToolExecutor. */
export function toToolHandlers(
  tools: Readonly<Record<string, ToolDef>>,
): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const [name, def] of Object.entries(tools)) {
    handlers.set(name, {
      schema: def.parameters,
      handler: def.handler as ToolHandler["handler"],
    });
  }
  return handlers;
}

/**
 * Create a Hono app with all agent routes.
 * Composable with other Hono apps:
 * ```ts
 * const agentApp = await routes(agent);
 * app.route("/", agentApp);
 * ```
 */
export async function routes(
  agent: AgentDef,
  opts?: { secrets?: Record<string, string>; clientDir?: string },
) {
  const { createAgentApp } = await import("../platform/server.ts");
  const { loadPlatformConfig } = await import("../platform/config.ts");

  const platformConfig = loadPlatformConfig(Deno.env.toObject());
  return createAgentApp({
    agent,
    secrets: opts?.secrets ?? Deno.env.toObject(),
    platformConfig,
    clientDir: opts?.clientDir,
  });
}

/** Start serving an agent on the given port. */
export async function serve(
  agent: AgentDef,
  opts?: { port?: number; clientDir?: string },
): Promise<Deno.HttpServer> {
  try {
    const { load } = await import("@std/dotenv");
    await load({ export: true });
  } catch {
    // .env not found — that's fine
  }

  const app = await routes(agent, {
    clientDir: opts?.clientDir ?? Deno.env.get("CLIENT_DIR"),
  });
  const port = opts?.port ?? parseInt(Deno.env.get("PORT") ?? "3000");

  const server = Deno.serve({ port }, app.fetch);
  console.log(`${agent.name} listening on http://localhost:${port}`);
  return server;
}
