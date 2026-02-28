// builtin-tools.ts — Server-side tools that run in-process.
//
// Built-in tools are opt-in via the agent's `builtinTools` array.

import { search, SafeSearchType } from "duck-duck-scrape";
import { html2md } from "@codybrom/html2md";
import { createLogger } from "./logger.ts";
import type { ToolSchema } from "./types.ts";

const log = createLogger("builtin-tools");

/** A server-side tool that runs with full Deno access. */
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

/** Max characters to return from a webpage to avoid blowing up context. */
const MAX_PAGE_CHARS = 10_000;

const visitWebpage: BuiltinTool = {
  name: "visit_webpage",
  description:
    "Fetch a webpage URL and return its content as clean Markdown. Useful for reading articles, documentation, or any web page found via search.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The full URL to fetch (e.g., 'https://example.com/page')",
      },
    },
    required: ["url"],
  },
  execute: async (args) => {
    const url = args.url as string;

    log.info({ url }, "visit_webpage");

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VoiceAgent/1.0; +https://github.com/AssemblyAI/aai-agent)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      return JSON.stringify({
        error: `Failed to fetch: ${resp.status} ${resp.statusText}`,
        url,
      });
    }

    const htmlContent = await resp.text();
    const markdown = html2md(htmlContent);

    const truncated = markdown.length > MAX_PAGE_CHARS;
    const content = truncated
      ? markdown.slice(0, MAX_PAGE_CHARS)
      : markdown;

    return JSON.stringify({
      url,
      content,
      ...(truncated
        ? { truncated: true, totalChars: markdown.length }
        : {}),
    });
  },
};

/** All available built-in tools, keyed by name. */
export const BUILTIN_TOOLS: Record<string, BuiltinTool> = {
  web_search: webSearch,
  visit_webpage: visitWebpage,
};

/**
 * Get tool schemas for the requested built-in tools.
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
  args: Record<string, unknown>,
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
