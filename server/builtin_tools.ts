import { z } from "zod";
import ddg from "@pikisoft/duckduckgo-search";
import { DOMParser } from "@b-fuze/deno-dom";
import { getLogger } from "../_utils/logger.ts";
import type { ToolSchema } from "./types.ts";

const log = getLogger("builtin-tools");

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return "";
  for (const tag of ["script", "style", "head"]) {
    for (const el of doc.querySelectorAll(tag)) el.remove();
  }
  for (
    const el of doc.querySelectorAll(
      "p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote",
    )
  ) {
    el.append("\n");
  }
  for (const el of doc.querySelectorAll("br")) el.replaceWith("\n");
  const text = doc.body?.textContent ?? doc.textContent ?? "";
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

    log.info("web_search", { query, maxResults });

    const results: { title: string; url: string; description: string }[] = [];
    for await (const r of ddg.text(query)) {
      results.push({ title: r.title, url: r.href, description: r.body });
      if (results.length >= maxResults) break;
    }

    return JSON.stringify(results);
  },
};

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

    log.info("visit_webpage", { url });

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

const runCodeParams = z.object({
  code: z
    .string()
    .describe("JavaScript code to execute. Use console.log() for output."),
});

const TIMEOUT_MS = 5_000;

const runCode: BuiltinTool = {
  name: "run_code",
  description:
    "Execute JavaScript in a sandboxed Deno subprocess with no permissions. Use console.log() for output. No network or filesystem access.",
  parameters: runCodeParams,
  execute: async (args) => {
    const { code } = runCodeParams.parse(args);

    log.info("run_code", { codeLength: code.length });

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--deny-net",
        "--deny-read",
        "--deny-write",
        "--deny-env",
        "--deny-sys",
        "--deny-run",
        "--deny-ffi",
        "-",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const proc = cmd.spawn();
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(code));
    await writer.close();

    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);

    try {
      const { code: exit, stdout, stderr } = await proc.output();
      clearTimeout(timer);

      const out = new TextDecoder().decode(stdout).trim();
      const err = new TextDecoder().decode(stderr).trim();

      if (exit !== 0) {
        return JSON.stringify({ error: err || "Execution failed" });
      }
      return out || "Code ran successfully (no output)";
    } catch {
      clearTimeout(timer);
      return JSON.stringify({ error: "Execution timed out" });
    }
  },
};

const fetchJsonParams = z.object({
  url: z.string().describe("The URL to fetch JSON from"),
  headers: z.record(z.string(), z.string()).optional().describe(
    "Optional HTTP headers to include in the request",
  ),
});

const fetchJson: BuiltinTool = {
  name: "fetch_json",
  description:
    "Fetch a URL via HTTP GET and return the JSON response. Useful for calling REST APIs that return JSON data.",
  parameters: fetchJsonParams,
  execute: async (args) => {
    const { url, headers } = fetchJsonParams.parse(args);

    log.info("fetch_json", { url });

    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      return JSON.stringify({
        error: `HTTP ${resp.status} ${resp.statusText}`,
        url,
      });
    }

    try {
      const data = await resp.json();
      return JSON.stringify(data);
    } catch {
      return JSON.stringify({
        error: "Response was not valid JSON",
        url,
      });
    }
  },
};

const BUILTIN_TOOLS: Record<string, BuiltinTool> = {
  web_search: webSearch,
  visit_webpage: visitWebpage,
  run_code: runCode,
  fetch_json: fetchJson,
};

export function getBuiltinToolSchemas(names: string[]): ToolSchema[] {
  return names.flatMap((name) => {
    const tool = BUILTIN_TOOLS[name];
    if (!tool) return [];
    return [{
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters) as Record<string, unknown>,
    }];
  });
}

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
    log.error("Built-in tool execution failed", { err, tool: name });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
