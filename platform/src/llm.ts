// llm.ts — LLM client (AssemblyAI LLM Gateway, OpenAI-compat).

import { ERR_INTERNAL } from "./errors.js";
import { LLM_GATEWAY_BASE, type ChatMessage, type LLMResponse, type ToolSchema } from "./types.js";

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

/**
 * Call the AssemblyAI LLM Gateway (OpenAI-compatible).
 */
export async function callLLM(
  messages: ChatMessage[],
  tools: ToolSchema[],
  apiKey: string,
  model: string,
  signal?: AbortSignal
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: sanitizeMessages(messages),
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const resp = await fetch(`${LLM_GATEWAY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(ERR_INTERNAL.LLM_REQUEST_FAILED(resp.status, text));
  }

  return (await resp.json()) as LLMResponse;
}
