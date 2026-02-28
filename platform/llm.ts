// llm.ts — LLM client (AssemblyAI LLM Gateway, OpenAI-compat).

import { ERR_INTERNAL } from "../sdk/errors.ts";
import {
  type ChatMessage,
  type LLMResponse,
  LLMResponseSchema,
  type ToolSchema,
} from "../sdk/types.ts";

/**
 * Replace empty text content with "..." (gateway rejects empty text blocks).
 */
function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string" && !msg.content.trim()) {
      return { ...msg, content: "..." };
    }
    return msg;
  });
}

/** Options for callLLM. */
export interface CallLLMOptions {
  messages: ChatMessage[];
  tools: ToolSchema[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  gatewayBase?: string;
  /** Injectable fetch — defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Call the AssemblyAI LLM Gateway (OpenAI-compatible).
 */
export async function callLLM(opts: CallLLMOptions): Promise<LLMResponse> {
  const base = opts.gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: sanitizeMessages(opts.messages),
  };

  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const resp = await fetchFn(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(ERR_INTERNAL.llmRequestFailed(resp.status, text));
  }

  const json = await resp.json();
  const parsed = LLMResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Invalid LLM response: ${
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ")
      }`,
    );
  }
  return parsed.data;
}
