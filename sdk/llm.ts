// llm.ts — LLM client (AssemblyAI LLM Gateway, OpenAI-compat).

import { ERR_INTERNAL } from "./errors.ts";
import {
  type ChatMessage,
  type LLMResponse,
  LLMResponseSchema,
  type ToolSchema,
} from "./types.ts";

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
  signal?: AbortSignal,
  gatewayBase?: string,
): Promise<LLMResponse> {
  const base = gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";

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

  const resp = await fetch(`${base}/chat/completions`, {
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
    throw new Error(ERR_INTERNAL.llmRequestFailed(resp.status, text));
  }

  const json = await resp.json();
  const parsed = LLMResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Invalid LLM response: ${
        parsed.error.issues.map((i) => i.message).join(", ")
      }`,
    );
  }
  return parsed.data;
}
