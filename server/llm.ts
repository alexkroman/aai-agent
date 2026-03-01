import { ERR_INTERNAL } from "./errors.ts";
import {
  type ChatMessage,
  type LLMResponse,
  LLMResponseSchema,
  type ToolSchema,
} from "./types.ts";

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string" && !msg.content.trim()) {
      return { ...msg, content: "..." };
    }
    return msg;
  });
}

export interface CallLLMOptions {
  messages: ChatMessage[];
  tools: ToolSchema[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  gatewayBase?: string;
  fetch?: typeof globalThis.fetch;
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  maxTokens?: number;
}

export async function callLLM(opts: CallLLMOptions): Promise<LLMResponse> {
  const base = opts.gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: sanitizeMessages(opts.messages),
    max_tokens: opts.maxTokens ?? 300,
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
    body.tool_choice = opts.toolChoice ?? "auto";
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
    throw new Error(`Invalid LLM response: ${parsed.error.message}`);
  }
  return parsed.data;
}
