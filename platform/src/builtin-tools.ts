// builtin-tools.ts — Server-side tools that run in Node.js (not the V8 sandbox).
//
// Built-in tools use npm libraries and have full Node.js access. Agents opt in
// to built-in tools by including their names in the configure message's
// `builtinTools` array.

import { search, SafeSearchType } from "duck-duck-scrape";
import { createLogger } from "./logger.js";
import type { ToolSchema } from "./types.js";

const log = createLogger("builtin-tools");

/** A server-side tool that runs in Node.js with full access. */
export interface BuiltinTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

const webSearch: BuiltinTool = {
  name: "web_search",
  description:
    "Search the web using DuckDuckGo. Returns a list of results with title, URL, and description.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default 5)",
      },
    },
    required: ["query"],
  },
  execute: async (args) => {
    const query = args.query as string;
    const maxResults = (args.max_results as number) ?? 5;

    log.info({ query, maxResults }, "web_search");

    const response = await search(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    const results = response.results.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));

    return JSON.stringify(results);
  },
};

/** All available built-in tools, keyed by name. */
export const BUILTIN_TOOLS: Record<string, BuiltinTool> = {
  web_search: webSearch,
};

/**
 * Get tool schemas for the requested built-in tools.
 * Skips unknown names silently.
 */
export function getBuiltinToolSchemas(names: string[]): ToolSchema[] {
  const schemas: ToolSchema[] = [];
  for (const name of names) {
    const tool = BUILTIN_TOOLS[name];
    if (tool) {
      schemas.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
    }
  }
  return schemas;
}

/**
 * Execute a built-in tool by name. Returns null if the tool is not a built-in.
 */
export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>
): Promise<string | null> {
  const tool = BUILTIN_TOOLS[name];
  if (!tool) return null;

  try {
    return await tool.execute(args);
  } catch (err) {
    log.error({ err, tool: name }, "Built-in tool execution failed");
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
