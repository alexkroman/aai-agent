// llm.ts — LLM client (AssemblyAI LLM Gateway, OpenAI-compat).

import {
  LLM_GATEWAY_BASE,
  type ChatMessage,
  type LLMResponse,
  type ToolSchema,
} from "./types.js";

const FINISH_REASON_MAP: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
};

/**
 * Sanitize outgoing request body:
 * - Replace empty text content with "..." (gateway rejects empty text blocks)
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
 * Patch response to be OpenAI-compatible:
 * - Map non-standard finish_reason values
 * - Fill missing id/model/usage fields
 */
function patchResponse(data: Record<string, unknown>): LLMResponse {
  if (!data.id) data.id = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
  if (!data.object) data.object = "chat.completion";
  if (!data.model) data.model = "unknown";

  const usage = (data.usage ?? {}) as Record<string, number>;
  usage.prompt_tokens ??= 0;
  usage.completion_tokens ??= 0;
  usage.total_tokens ??= 0;
  data.usage = usage;

  const choices = (data.choices ?? []) as Record<string, unknown>[];
  for (const choice of choices) {
    choice.index ??= 0;
    const fr = choice.finish_reason as string | null;
    if (fr && fr in FINISH_REASON_MAP) {
      choice.finish_reason = FINISH_REASON_MAP[fr];
    } else if (fr === null || fr === undefined) {
      choice.finish_reason = "stop";
    }
  }

  return data as unknown as LLMResponse;
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
    throw new Error(`LLM request failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  return patchResponse(data);
}
