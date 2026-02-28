// builtin-tools.ts — Server-side tools that run in-process.
//
// Built-in tools are opt-in via the agent's `builtinTools` array.

import { z } from "zod";
import ddg from "@pikisoft/duckduckgo-search";
import { mapNotNullish } from "@std/collections/map-not-nullish";
import { createLogger } from "./logger.ts";
import { zodToJsonSchema } from "./protocol.ts";
import type { ToolSchema } from "./types.ts";

const log = createLogger("builtin-tools");

/** Lightweight HTML → readable text. No DOM parser needed. */
export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<head[\s\S]*?<\/head>/gi, "");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|br\s*\/?)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** A server-side tool that runs with full Deno access. */
interface BuiltinTool {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

const webSearchParams = z.object({
  query: z.string().describe("The search query"),
  max_results: z
    .number()
    .describe("Maximum number of results to return (default 5)")
    .optional(),
});

const webSearch: BuiltinTool = {
  name: "web_search",
  description:
    "Search the web using DuckDuckGo. Returns a list of results with title, URL, and description.",
  parameters: webSearchParams,
  execute: async (args) => {
    const { query, max_results } = webSearchParams.parse(args);
    const maxResults = max_results ?? 5;

    log.info({ query, maxResults }, "web_search");

    const results: { title: string; url: string; description: string }[] = [];
    for await (const r of ddg.text(query)) {
      results.push({ title: r.title, url: r.href, description: r.body });
      if (results.length >= maxResults) break;
    }

    return JSON.stringify(results);
  },
};

/** Max characters to return from a webpage to avoid blowing up context. */
const MAX_PAGE_CHARS = 10_000;

const visitWebpageParams = z.object({
  url: z
    .string()
    .describe("The full URL to fetch (e.g., 'https://example.com/page')"),
});

const visitWebpage: BuiltinTool = {
  name: "visit_webpage",
  description:
    "Fetch a webpage URL and return its content as clean Markdown. Useful for reading articles, documentation, or any web page found via search.",
  parameters: visitWebpageParams,
  execute: async (args) => {
    const { url } = visitWebpageParams.parse(args);

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
    const markdown = htmlToText(htmlContent);

    const truncated = markdown.length > MAX_PAGE_CHARS;
    const content = truncated ? markdown.slice(0, MAX_PAGE_CHARS) : markdown;

    return JSON.stringify({
      url,
      content,
      ...(truncated ? { truncated: true, totalChars: markdown.length } : {}),
    });
  },
};

/** All available built-in tools, keyed by name. */
const BUILTIN_TOOLS: Record<string, BuiltinTool> = {
  web_search: webSearch,
  visit_webpage: visitWebpage,
};

/**
 * Get tool schemas for the requested built-in tools.
 */
export function getBuiltinToolSchemas(names: string[]): ToolSchema[] {
  return mapNotNullish(names, (name) => {
    const tool = BUILTIN_TOOLS[name];
    if (!tool) return null;
    return {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    };
  });
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

  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(", ");
    return `Error: invalid arguments — ${issues}`;
  }

  try {
    return await tool.execute(parsed.data as Record<string, unknown>);
  } catch (err) {
    log.error({ err, tool: name }, "Built-in tool execution failed");
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
